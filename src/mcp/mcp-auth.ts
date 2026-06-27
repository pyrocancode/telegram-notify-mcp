import type { Request } from "express";
import type { TelegramConfig } from "../telegram/telegram-api";

export const TELEGRAM_BOT_TOKEN_HEADER = "x-telegram-bot-token";
export const TELEGRAM_CHAT_ID_HEADER = "x-telegram-chat-id";

export type McpAuthResult =
  | { ok: true; telegram: TelegramConfig }
  | { ok: false; status: number; message: string };

function telegramFromHeaders(req: Request): Partial<TelegramConfig> {
  const botToken = req.headers[TELEGRAM_BOT_TOKEN_HEADER] as string | undefined;
  const defaultChatId = req.headers[TELEGRAM_CHAT_ID_HEADER] as string | undefined;
  return {
    ...(botToken ? { botToken } : {}),
    ...(defaultChatId ? { defaultChatId } : {}),
  };
}

export function resolveTelegramConfig(
  partial: Partial<TelegramConfig> = {},
): TelegramConfig | null {
  const botToken = partial.botToken ?? process.env.TELEGRAM_BOT_TOKEN?.trim();
  const defaultChatId =
    partial.defaultChatId ?? process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !defaultChatId) return null;
  return { botToken, defaultChatId };
}

export function checkMcpAuth(req: Request): McpAuthResult {
  const secret = process.env.MCP_SECRET?.trim();
  const fromHeaders = telegramFromHeaders(req);
  const telegram = resolveTelegramConfig(fromHeaders);
  const hasClientTelegram = Boolean(
    req.headers[TELEGRAM_BOT_TOKEN_HEADER] && req.headers[TELEGRAM_CHAT_ID_HEADER],
  );

  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!telegram) {
      return {
        ok: false,
        status: 400,
        message:
          "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required (headers X-Telegram-Bot-Token, X-Telegram-Chat-Id or server env)",
      };
    }
    return { ok: true, telegram };
  }

  if (hasClientTelegram && telegram) {
    return { ok: true, telegram };
  }

  if (telegram) {
    return { ok: true, telegram };
  }

  return {
    ok: false,
    status: 503,
    message:
      "Configure MCP_SECRET or send X-Telegram-Bot-Token and X-Telegram-Chat-Id headers",
  };
}
