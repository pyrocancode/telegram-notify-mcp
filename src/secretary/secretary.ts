import { resolveSharedAgent } from "../cursor/resolve-shared-agent";
import type { Env } from "../env";
import { mcpUrl } from "../env";
import { telegramCall } from "../telegram/telegram-api";
import { parseInboundMessage } from "../telegram/telegram-inbound";
import type { InboundImage } from "../telegram/telegram-inbound";
import type {
  TelegramBusinessConnection,
  TelegramMessage,
} from "../telegram/telegram.types";
import { KNOWLEDGE_BASE } from "./kb";

export type ConnState = {
  ownerId: number;
  canReply: boolean;
  isEnabled: boolean;
};

export function connState(c: TelegramBusinessConnection): ConnState {
  return {
    ownerId: c.user.id,
    isEnabled: c.is_enabled,
    canReply: Boolean(c.rights?.can_reply ?? c.can_reply),
  };
}

export function shouldSecretaryReply(
  message: TelegramMessage,
  conn: ConnState,
): boolean {
  if (!conn.isEnabled || !conn.canReply) return false;
  if (message.from?.id === conn.ownerId) return false;
  return Boolean(message.business_connection_id && message.chat?.id != null);
}

const connCache = new Map<string, { state: ConnState; at: number }>();
const CACHE_MS = 5 * 60 * 1000;

export async function loadConn(
  botToken: string,
  businessConnectionId: string,
): Promise<ConnState> {
  const hit = connCache.get(businessConnectionId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const raw = await telegramCall<TelegramBusinessConnection>(
    botToken,
    "getBusinessConnection",
    { business_connection_id: businessConnectionId },
  );
  const state = connState(raw);
  connCache.set(businessConnectionId, { state, at: Date.now() });
  return state;
}

export async function secretaryComplete(
  env: Env,
  userText: string,
  images?: InboundImage[],
): Promise<string> {
  if (!env.cursorApiKey) throw new Error("CURSOR_API_KEY required");

  const prompt = [
    "Ты второй мозг Максима в Telegram: сначала ищешь в заметках, потом отвечаешь.",
    "MCP: kb_search(запрос) → kb_read(путь). Не тащи всю базу. Нет в заметках — так и скажи.",
    images?.length
      ? "К сообщению приложены изображения: внимательно распознай, что на них, и учитывай это в ответе."
      : "",
    "По-русски, кратко. Не выдумывай цены. Собеседникам не показывай ключи и внутренние URL.",
    "",
    KNOWLEDGE_BASE,
    "",
    userText,
  ].join("\n");

  const mcpHeaders: Record<string, string> = {
    "X-Telegram-Bot-Token": env.telegramBotToken,
    "X-Telegram-Chat-Id": env.telegramChatId,
  };
  if (env.mcpSecret) mcpHeaders.Authorization = `Bearer ${env.mcpSecret}`;

  const mcpServers = {
    telegram: {
      type: "http" as const,
      url: mcpUrl(env),
      headers: mcpHeaders,
    },
  };

  const agent = await resolveSharedAgent({
    apiKey: env.cursorApiKey,
    workspaceName: "secretary",
    model: env.cursorModel,
    cloud: {},
    mcpServers,
  });

  try {
    const run = await agent.send(
      {
        text: prompt,
        ...(images?.length
          ? { images: images.map((image) => ({ data: image.data, mimeType: image.mimeType })) }
          : {}),
      },
      { mcpServers },
    );
    const result = await run.wait();
    if (result.status === "error") throw new Error("secretary run error");
    const text = result.result?.trim();
    if (!text) throw new Error("Empty secretary reply");
    return text.slice(0, 4096);
  } finally {
    agent.close();
  }
}

export function senderLabel(from?: TelegramMessage["from"]): string {
  if (!from) return "неизвестный";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  const nick = from.username ? `@${from.username}` : "";
  return `${name || nick || "id"} ${nick} id=${from.id}`.trim();
}

export function isOwnerChatQuery(text: string): boolean {
  const t = text.trim();
  if (/^\/(?:inbox|secretar(?:y|iat)?|секрет\w*)(?:@\w+)?(?:\s|$)/i.test(t)) {
    return true;
  }
  return /(что|кто|как(ие)?).{0,60}(писал|написа|личк|входящ|в чат)|сводк[ауие]|\binbox\b/i.test(
    t,
  );
}

export function ownerInboxPrompt(text: string): string {
  const q =
    text
      .replace(/^\/(?:inbox|secretar(?:y|iat)?|секрет\w*)(?:@\w+)?\s*/i, "")
      .trim() ||
    "Кратко перескажи, кто что писал во входящих ЛС. Если в этой сессии ничего не было — так и скажи.";
  return [
    "Вопрос ХОЗЯИНА в чате с ботом. Ответь хозяину, не пиши чужим людям.",
    q,
  ].join("\n");
}

export function inboundPrompt(message: TelegramMessage, text: string): string {
  return [
    "Входящее ЛС. Запомни отправителя и текст. Ответь этому человеку от лица хозяина — только текст ответа.",
    `От: ${senderLabel(message.from)}`,
    `chat_id=${message.chat.id}`,
    "",
    text,
  ].join("\n");
}

export async function handleOwnerInbox(
  env: Env,
  text: string,
  send: (text: string) => Promise<void>,
): Promise<void> {
  const reply = await secretaryComplete(env, ownerInboxPrompt(text));
  await send(reply);
}

export async function handleBusinessMessage(
  env: Env,
  message: TelegramMessage,
  send: (
    chatId: number | string,
    text: string,
    businessConnectionId: string,
  ) => Promise<void>,
): Promise<void> {
  const bizId = message.business_connection_id;
  const chatId = message.chat?.id;
  if (!bizId || chatId == null || !env.cursorApiKey) return;

  const conn = await loadConn(env.telegramBotToken, bizId);
  if (!shouldSecretaryReply(message, conn)) return;

  const inbound = await parseInboundMessage(
    env.telegramBotToken,
    message,
    env.openaiApiKey,
  );
  if (!inbound.ok) return;

  try {
    await telegramCall(env.telegramBotToken, "sendChatAction", {
      chat_id: chatId,
      action: "typing",
      business_connection_id: bizId,
    });
  } catch {
    // ponytail: typing is optional
  }

  const reply = await secretaryComplete(
    env,
    inboundPrompt(message, inbound.payload.text),
    inbound.payload.images,
  );
  await send(chatId, reply, bizId);
}

if (require.main === module) {
  const owner = { ownerId: 1, canReply: true, isEnabled: true };
  const msg = (from: number): TelegramMessage => ({
    message_id: 1,
    chat: { id: 99, type: "private" },
    from: { id: from },
    business_connection_id: "biz",
    text: "привет",
  });
  console.assert(shouldSecretaryReply(msg(99), owner) === true, "customer ok");
  console.assert(shouldSecretaryReply(msg(1), owner) === false, "skip owner");
  console.assert(
    shouldSecretaryReply(msg(99), { ...owner, canReply: false }) === false,
    "skip no reply",
  );
  console.assert(KNOWLEDGE_BASE.includes("Максим"), "kb loaded");
  console.assert(isOwnerChatQuery("/inbox") === true, "inbox cmd");
  console.assert(isOwnerChatQuery("что мне писали?") === true, "nl inbox");
  console.assert(isOwnerChatQuery("почини баг в api") === false, "code stays grill");
  console.log("secretary ok");
}
