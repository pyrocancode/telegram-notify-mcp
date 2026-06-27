export type TelegramConfig = {
  botToken: string;
  defaultChatId: string;
};

export type ParseMode = "HTML" | "MarkdownV2" | "Markdown";

export async function telegramCall<T = unknown>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(data.description ?? `Telegram API error: ${method}`);
  }
  return data.result as T;
}

export function resolveChatId(
  config: TelegramConfig,
  chatId?: string,
): string {
  return chatId ?? config.defaultChatId;
}
