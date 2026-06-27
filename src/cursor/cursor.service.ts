import { Injectable, Logger } from "@nestjs/common";
import { CursorAgentError } from "@cursor/sdk";
import { loadEnv, mcpUrl } from "../env";
import { resolveSharedAgent } from "./resolve-shared-agent";
import { TelegramCascadeStreamer } from "../telegram/telegram-cascade";
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

    const streamer = new TelegramCascadeStreamer(
      this.env.telegramBotToken,
      chatId,
    );

    const prompt = [
      `Продолжение диалога в workspace «${this.env.cursorWorkspaceName}».`,
      "Выполни запрос пользователя из Telegram.",
      "",
      `Запрос: ${text}`,
      "",
      "Текст ответа стримится в Telegram автоматически (по предложениям).",
      "Не дублируй финальный ответ через send_notification.",
      "MCP telegram используй только для send_chat_action (typing) при долгой работе.",
      "Пиши кратко, по-русски.",
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

    const agent = await resolveSharedAgent(
      {
        apiKey: this.env.cursorApiKey,
        workspaceName: this.env.cursorWorkspaceName,
        agentId: this.env.cursorAgentId,
        model: this.env.cursorModel,
        cloud,
        mcpServers,
      },
      (msg) => this.log.warn(msg),
    );
    this.log.log(`agent ${agent.agentId} (${this.env.cursorWorkspaceName})`);

    try {
      const run = await agent.send(prompt, {
        mcpServers,
        onDelta: ({ update }) => {
          if (update.type === "text-delta" && update.text) {
            return streamer.append(update.text).catch((err) => {
              this.log.warn(
                `stream append failed: ${err instanceof Error ? err.message : err}`,
              );
            });
          }
        },
      });
      this.log.log(`run started: ${run.id} agent=${agent.agentId}`);

      const result = await run.wait();
      await streamer.finish();

      if (result.status === "error") {
        this.log.error(`run error: ${result.id}`);
        await this.telegram.sendText(
          chatId,
          "Агент завершился с ошибкой. Смотри run в Cursor dashboard.",
        );
        return;
      }

      const reply = result.result?.trim();
      if (reply && !streamer.hasSent()) {
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
