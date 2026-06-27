import { downloadTelegramFile } from "./telegram-files";

export async function transcribeTelegramVoice(
  botToken: string,
  fileId: string,
  openaiApiKey: string,
): Promise<string> {
  const audio = await downloadTelegramFile(botToken, fileId);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: "audio/ogg" }),
    "voice.ogg",
  );
  form.append("model", "whisper-1");
  form.append("language", "ru");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiApiKey}` },
    body: form,
  });
  const data = (await res.json()) as { text?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Whisper HTTP ${res.status}`);
  }
  const text = data.text?.trim();
  if (!text) throw new Error("Empty transcription");
  return text;
}
