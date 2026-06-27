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
import { loadEnv } from "../env";
import { parseInboundMessage } from "./telegram-inbound";
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
    const chatId = message?.chat.id;

    if (!message || chatId == null) {
      return { ok: true };
    }

    if (!this.telegram.isAllowedChat(chatId)) {
      this.log.warn(`ignored chat ${chatId}`);
      return { ok: true };
    }

    const textOnly = message.text?.trim();
    if (textOnly === "/start" || (textOnly && /^прив(ет)?$/i.test(textOnly))) {
      await this.telegram.sendText(
        chatId,
        "Привет. Напиши задачу, пришли фото/файл или голосовое — запущу cloud-агента Cursor.",
      );
      return { ok: true };
    }

    const env = loadEnv();
    let inbound;
    try {
      inbound = await parseInboundMessage(
        env.telegramBotToken,
        message,
        env.openaiApiKey,
      );
    } catch (err) {
      this.log.error("inbound media failed", err);
      await this.telegram.sendText(
        chatId,
        "Не удалось обработать вложение. Попробуй меньший файл или напиши текстом.",
      );
      return { ok: true };
    }

    if (!inbound.ok) {
      if (inbound.reason === "voice_no_whisper") {
        await this.telegram.sendText(
          chatId,
          "Голосовые пока не настроены. Добавь OPENAI_API_KEY на Vercel или напиши текстом.",
        );
      }
      return { ok: true };
    }

    const { text, images } = inbound.payload;

    await this.telegram.sendText(chatId, "Принял, запускаю агента…");

    waitUntil(
      this.cursor
        .runFromTelegram({ chatId: String(chatId), text, images })
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
