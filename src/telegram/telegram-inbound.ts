import { downloadTelegramFile } from "./telegram-files";
import { transcribeTelegramVoice } from "./transcribe-voice";
import type { TelegramMessage } from "./telegram.types";

export type InboundImage = { data: string; mimeType: string };

export type InboundPayload = {
  text: string;
  images?: InboundImage[];
};

export type InboundResult =
  | { ok: true; payload: InboundPayload }
  | { ok: false; reason: "empty" | "voice_no_whisper" };

const TEXT_MIME = /^(text\/|application\/json|application\/xml)/;
const MAX_TEXT_DOC = 64 * 1024;

function largestPhotoFileId(message: TelegramMessage): string | undefined {
  const photos = message.photo;
  if (!photos?.length) return undefined;
  return [...photos].sort(
    (a, b) => (b.file_size ?? 0) - (a.file_size ?? 0),
  )[0]?.file_id;
}

export async function parseInboundMessage(
  botToken: string,
  message: TelegramMessage,
  openaiApiKey?: string,
): Promise<InboundResult> {
  const caption = message.caption?.trim() ?? "";
  const parts: string[] = [];
  const images: InboundImage[] = [];

  if (message.text?.trim()) {
    parts.push(message.text.trim());
  }

  const photoId = largestPhotoFileId(message);
  if (photoId) {
    const buf = await downloadTelegramFile(botToken, photoId);
    images.push({
      data: buf.toString("base64"),
      mimeType: "image/jpeg",
    });
    parts.push(caption || "[фото от пользователя]");
  }

  const doc = message.document;
  if (doc?.file_id) {
    const name = doc.file_name ?? "file";
    const mime = doc.mime_type ?? "application/octet-stream";
    if (TEXT_MIME.test(mime) || /\.(md|txt|json|ya?ml|csv)$/i.test(name)) {
      const buf = await downloadTelegramFile(botToken, doc.file_id);
      if (buf.length <= MAX_TEXT_DOC) {
        parts.push(
          `Файл «${name}»:\n\n${buf.toString("utf8").slice(0, MAX_TEXT_DOC)}`,
        );
      } else {
        parts.push(`Файл «${name}» слишком большой для вставки в промпт.`);
      }
    } else if (mime.startsWith("image/")) {
      const buf = await downloadTelegramFile(botToken, doc.file_id);
      images.push({ data: buf.toString("base64"), mimeType: mime });
      parts.push(caption || `Изображение «${name}»`);
    } else {
      parts.push(
        caption ||
          `Пользователь прислал файл «${name}» (${mime}). Содержимое недоступно — попроси прислать текстом или картинкой.`,
      );
    }
  }

  if (message.voice?.file_id) {
    if (!openaiApiKey) return { ok: false, reason: "voice_no_whisper" };
    const transcript = await transcribeTelegramVoice(
      botToken,
      message.voice.file_id,
      openaiApiKey,
    );
    parts.push(`[голосовое → текст]: ${transcript}`);
  }

  if (!parts.length && !images.length) return { ok: false, reason: "empty" };

  return {
    ok: true,
    payload: {
      text: parts.join("\n\n").trim() || "[медиа без текста]",
      images: images.length ? images : undefined,
    },
  };
}
