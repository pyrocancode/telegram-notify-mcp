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
import { handleBusinessMessage } from "../secretary/secretary";
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
    if (!this.telegram.verifyWebhookSecret(secret)) {
      throw new UnauthorizedException();
    }

    if (
      !this.telegram.isBridgeEnabled() &&
      !this.telegram.isSecretaryEnabled()
    ) {
      throw new ServiceUnavailableException("Telegram webhook not configured");
    }

    if (update.business_message) {
      if (this.telegram.isSecretaryEnabled()) {
        const env = loadEnv();
        waitUntil(
          handleBusinessMessage(env, update.business_message, (id, text, biz) =>
            this.telegram.sendText(id, text, biz),
          ).catch((err) => {
            this.log.error("secretary failed", err);
          }),
        );
      }
      return { ok: true };
    }

    const message = update.message;
    const chatId = message?.chat.id;

    if (!this.telegram.isBridgeEnabled() || !message || chatId == null) {
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
