import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../env";
import { telegramCall } from "./telegram-api";

@Injectable()
export class TelegramService {
  private readonly log = new Logger(TelegramService.name);
  private readonly env = loadEnv();

  isAllowedChat(chatId: number | string): boolean {
    return this.env.allowedChatIds.has(String(chatId));
  }

  verifyWebhookSecret(header?: string): boolean {
    return header === this.env.telegramWebhookSecret;
  }

  isBridgeEnabled(): boolean {
    return this.env.bridgeEnabled;
  }

  isSecretaryEnabled(): boolean {
    return this.env.secretaryEnabled;
  }

  async installWebhook(): Promise<{ ok: boolean; url: string }> {
    const url = `${this.env.publicUrl.replace(/\/$/, "")}/telegram/webhook`;
    await telegramCall(this.env.telegramBotToken, "setWebhook", {
      url,
      secret_token: this.env.telegramWebhookSecret,
      allowed_updates: [
        "message",
        "business_message",
        "business_connection",
      ],
    });
    return { ok: true, url };
  }

  async sendText(
    chatId: number | string,
    text: string,
    businessConnectionId?: string,
  ): Promise<void> {
    try {
      await telegramCall(this.env.telegramBotToken, "sendMessage", {
        chat_id: chatId,
        text,
        ...(businessConnectionId
          ? { business_connection_id: businessConnectionId }
          : {}),
      });
    } catch (err) {
      this.log.error(
        `sendMessage failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
