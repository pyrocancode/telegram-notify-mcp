import { Injectable, Logger } from "@nestjs/common";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { loadEnv, mcpUrl } from "../env";
import { TelegramService } from "../telegram/telegram.service";

type RunInput = { chatId: string; text: string };

@Injectable()
export class CursorService {
  private readonly log = new Logger(CursorService.name);
  private readonly env = loadEnv();

  constructor(private readonly telegram: TelegramService) {}

  async runFromTelegram({ chatId, text }: RunInput): Promise<void> {
    if (!this.env.bridgeEnabled || !this.env.cursorApiKey) {
      throw new Error("Cursor bridge is not configured");
    }

    const prompt = [
      "Тебя запустили из Telegram. Выполни запрос пользователя.",
      "",
      `Запрос: ${text}`,
      "",
      "Когда закончишь, ответь через MCP `telegram` → `send_notification`.",
      `Передай chat_id: "${chatId}" если инструмент это поддерживает.`,
      "Пиши кратко, по-русски. HTML parse_mode при необходимости.",
    ].join("\n");

    const mcpHeaders: Record<string, string> = {
      "X-Telegram-Bot-Token": this.env.telegramBotToken,
      "X-Telegram-Chat-Id": chatId,
    };
    if (this.env.mcpSecret) {
      mcpHeaders.Authorization = `Bearer ${this.env.mcpSecret}`;
    }

    const mcpServers = {
      telegram: {
        type: "http" as const,
        url: mcpUrl(this.env),
        headers: mcpHeaders,
      },
    };

    const cloud = this.env.cursorRepoUrl
      ? {
          repos: [
            {
              url: this.env.cursorRepoUrl,
              startingRef: this.env.cursorRepoRef,
            },
          ],
        }
      : {};

    const agent = await Agent.create({
      apiKey: this.env.cursorApiKey,
      model: { id: this.env.cursorModel },
      cloud,
      mcpServers,
    });

    try {
      const run = await agent.send(prompt, { mcpServers });
      this.log.log(`run started: ${run.id} agent=${agent.agentId}`);

      const result = await run.wait();
      if (result.status === "error") {
        this.log.error(`run error: ${result.id}`);
        await this.telegram.sendText(
          chatId,
          "Агент завершился с ошибкой. Смотри run в Cursor dashboard.",
        );
        return;
      }

      // ponytail: fallback if agent forgot send_notification via MCP
      const reply = result.result?.trim();
      if (reply) {
        await this.telegram.sendText(chatId, reply.slice(0, 4096));
      }
    } catch (err) {
      if (err instanceof CursorAgentError) {
        this.log.error(`startup failed: ${err.message}`);
      }
      throw err;
    } finally {
      agent.close();
    }
  }
}
