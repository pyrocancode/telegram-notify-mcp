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

  async sendText(chatId: number | string, text: string): Promise<void> {
    try {
      await telegramCall(this.env.telegramBotToken, "sendMessage", {
        chat_id: chatId,
        text,
      });
    } catch (err) {
      this.log.error(
        `sendMessage failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
