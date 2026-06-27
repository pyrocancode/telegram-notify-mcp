import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { CursorService } from "../cursor/cursor.service";
import { TelegramService } from "./telegram.service";
import type { TelegramUpdate } from "./telegram.types";

@Controller("telegram")
export class TelegramController {
  private readonly log = new Logger(TelegramController.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly cursor: CursorService,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers("x-telegram-bot-api-secret-token") secret?: string,
  ) {
    if (!this.telegram.isBridgeEnabled()) {
      throw new ServiceUnavailableException("Cursor bridge not configured");
    }

    if (!this.telegram.verifyWebhookSecret(secret)) {
      throw new UnauthorizedException();
    }

    const message = update.message;
    const text = message?.text?.trim();
    const chatId = message?.chat.id;

    if (!message || chatId == null || !text) {
      return { ok: true };
    }

    if (!this.telegram.isAllowedChat(chatId)) {
      this.log.warn(`ignored chat ${chatId}`);
      return { ok: true };
    }

    if (text === "/start" || /^прив(ет)?$/i.test(text)) {
      await this.telegram.sendText(
        chatId,
        "Привет. Напиши задачу — запущу cloud-агента Cursor. Ответ придёт сюда же.",
      );
      return { ok: true };
    }

    await this.telegram.sendText(chatId, "Принял, запускаю агента…");

    waitUntil(
      this.cursor
        .runFromTelegram({ chatId: String(chatId), text })
        .catch((err) => {
          this.log.error("cursor run failed", err);
          return this.telegram.sendText(
            chatId,
            "Не удалось запустить агента. Проверь логи на Vercel.",
          );
        }),
    );

    return { ok: true };
  }
}
