import { resolveSharedAgent } from "../cursor/resolve-shared-agent";
import type { Env } from "../env";
import { telegramCall } from "../telegram/telegram-api";
import { parseInboundMessage } from "../telegram/telegram-inbound";
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
): Promise<string> {
  if (!env.cursorApiKey) throw new Error("CURSOR_API_KEY required");

  const prompt = [
    "Ты секретарь в личных сообщениях Telegram.",
    "Пишешь от лица хозяина аккаунта, коротко, по-русски.",
    "Факты только из базы знаний. Не обещай того, чего там нет.",
    "Не пиши код и не вызывай инструменты — только текст ответа собеседнику.",
    "",
    "База знаний:",
    KNOWLEDGE_BASE,
    "",
    "Сообщение:",
    userText,
  ].join("\n");

  // ponytail: отдельный агент «secretary», не grill — иначе agent_busy. Нет repo/MCP.
  const agent = await resolveSharedAgent({
    apiKey: env.cursorApiKey,
    workspaceName: "secretary",
    model: env.cursorModel,
    cloud: {},
  });

  try {
    const run = await agent.send({ text: prompt });
    const result = await run.wait();
    if (result.status === "error") throw new Error("secretary run error");
    const text = result.result?.trim();
    if (!text) throw new Error("Empty secretary reply");
    return text.slice(0, 4096);
  } finally {
    agent.close();
  }
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

  const reply = await secretaryComplete(env, inbound.payload.text);
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
  console.log("secretary ok");
}
