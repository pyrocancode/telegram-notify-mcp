import { telegramCall } from "./telegram-api";

const SENTENCE_END = /[.!?…](?:\s+|\n|$)/;

/** ponytail: naive sentence split; may break on «т. д.» — upgrade: NLP or agent-side send */
export function takeCompletedSentences(buffer: string): {
  sentences: string[];
  rest: string;
} {
  const sentences: string[] = [];
  let rest = buffer;
  while (rest.length > 0) {
    const m = rest.match(SENTENCE_END);
    if (!m || m.index === undefined) break;
    let cut = m.index + m[0].length;
    while (cut < rest.length && /\s/.test(rest[cut]!)) cut++;
    const sentence = rest.slice(0, cut).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(cut);
  }
  return { sentences, rest };
}

export class TelegramCascadeStreamer {
  private buffer = "";
  private lastDraftAt = 0;
  private sentAny = false;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly draftId = 1,
    private readonly draftThrottleMs = 400,
  ) {}

  hasSent(): boolean {
    return this.sentAny;
  }

  async append(delta: string): Promise<void> {
    if (!delta) return;
    this.buffer += delta;
    await this.flushSentences();
    await this.maybeUpdateDraft();
  }

  async finish(): Promise<void> {
    await this.flushSentences();
    const tail = this.buffer.trim();
    if (tail) {
      await this.sendMessage(tail);
      this.buffer = "";
    }
    await this.clearDraft();
  }

  private async flushSentences(): Promise<void> {
    const { sentences, rest } = takeCompletedSentences(this.buffer);
    this.buffer = rest;
    for (const sentence of sentences) {
      await this.sendMessage(sentence);
      await this.clearDraft();
    }
  }

  private async maybeUpdateDraft(): Promise<void> {
    const draft = this.buffer.trim();
    if (!draft) return;
    const now = Date.now();
    if (now - this.lastDraftAt < this.draftThrottleMs) return;
    this.lastDraftAt = now;
    try {
      await telegramCall(this.botToken, "sendMessageDraft", {
        chat_id: this.chatId,
        draft_id: this.draftId,
        text: draft.slice(0, 4096),
      });
    } catch {
      // ponytail: draft API optional — sentence sends still work
    }
  }

  private async sendMessage(text: string): Promise<void> {
    await telegramCall(this.botToken, "sendMessage", {
      chat_id: this.chatId,
      text: text.slice(0, 4096),
    });
    this.sentAny = true;
  }

  private async clearDraft(): Promise<void> {
    try {
      await telegramCall(this.botToken, "sendMessageDraft", {
        chat_id: this.chatId,
        draft_id: this.draftId,
        text: "",
      });
    } catch {
      /* ignore */
    }
  }
}

if (require.main === module) {
  const { sentences, rest } = takeCompletedSentences(
    "Первое. Второе! Третье?",
  );
  if (
    sentences.join("|") !== "Первое.|Второе!|Третье?" ||
    rest !== ""
  ) {
    throw new Error("takeCompletedSentences failed");
  }
  console.log("telegram-cascade ok");
}
