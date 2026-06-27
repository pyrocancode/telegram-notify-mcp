import { telegramCall } from "./telegram-api";

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

type TgFile = { file_id: string; file_path?: string; file_size?: number };

export async function getTelegramFile(
  botToken: string,
  fileId: string,
): Promise<TgFile> {
  return telegramCall<TgFile>(botToken, "getFile", { file_id: fileId });
}

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<Buffer> {
  const meta = await getTelegramFile(botToken, fileId);
  if (meta.file_size && meta.file_size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large (${meta.file_size} bytes)`);
  }
  if (!meta.file_path) throw new Error("Telegram file_path missing");
  const url = `https://api.telegram.org/file/bot${botToken}/${meta.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large (${buf.length} bytes)`);
  }
  return buf;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large (${buf.length} bytes)`);
  }
  return buf;
}

export async function sendPhotoMultipart(
  botToken: string,
  chatId: string,
  file: Buffer,
  filename: string,
  opts: { caption?: string; parse_mode?: string; silent?: boolean } = {},
): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new Blob([new Uint8Array(file)]), filename);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.parse_mode) form.append("parse_mode", opts.parse_mode);
  if (opts.silent) form.append("disable_notification", "true");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!data.ok) throw new Error(data.description ?? "sendPhoto failed");
  return data.result!;
}

export async function sendDocumentMultipart(
  botToken: string,
  chatId: string,
  file: Buffer,
  filename: string,
  opts: { caption?: string; parse_mode?: string; silent?: boolean } = {},
): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([new Uint8Array(file)]), filename);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.parse_mode) form.append("parse_mode", opts.parse_mode);
  if (opts.silent) form.append("disable_notification", "true");

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    { method: "POST", body: form },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!data.ok) throw new Error(data.description ?? "sendDocument failed");
  return data.result!;
}

export async function sendPhotoFromSource(
  botToken: string,
  chatId: string,
  source: { url?: string; base64?: string; filename?: string },
  opts: { caption?: string; parse_mode?: string; silent?: boolean } = {},
): Promise<{ message_id: number }> {
  if (source.url) {
    return telegramCall(botToken, "sendPhoto", {
      chat_id: chatId,
      photo: source.url,
      caption: opts.caption,
      ...opts.parse_mode ? { parse_mode: opts.parse_mode } : {},
      disable_notification: opts.silent ?? false,
    });
  }
  if (source.base64) {
    const file = Buffer.from(source.base64, "base64");
    return sendPhotoMultipart(
      botToken,
      chatId,
      file,
      source.filename ?? "photo.jpg",
      opts,
    );
  }
  throw new Error("photo_url or photo_base64 required");
}

export async function sendDocumentFromSource(
  botToken: string,
  chatId: string,
  source: { url?: string; base64?: string; filename: string },
  opts: { caption?: string; parse_mode?: string; silent?: boolean } = {},
): Promise<{ message_id: number }> {
  if (source.url) {
    return telegramCall(botToken, "sendDocument", {
      chat_id: chatId,
      document: source.url,
      caption: opts.caption,
      ...opts.parse_mode ? { parse_mode: opts.parse_mode } : {},
      disable_notification: opts.silent ?? false,
    });
  }
  if (source.base64) {
    const file = Buffer.from(source.base64, "base64");
    return sendDocumentMultipart(botToken, chatId, file, source.filename, opts);
  }
  throw new Error("document_url or document_base64 required");
}

export { fetchBytes };

if (require.main === module) {
  const b = Buffer.from("aGVsbG8=", "base64").toString();
  if (b !== "hello") throw new Error("base64 roundtrip failed");
  console.log("telegram-files ok");
}
