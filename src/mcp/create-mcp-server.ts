import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveChatId,
  telegramCall,
  type TelegramConfig,
} from "../telegram/telegram-api";

const parseModeSchema = z
  .enum(["HTML", "MarkdownV2", "Markdown"])
  .optional()
  .describe("Text formatting mode (HTML recommended)");

const chatIdSchema = z.string().optional().describe("Override chat ID");
const silentSchema = z
  .boolean()
  .optional()
  .describe("Send without notification sound");

const richContentSchema = {
  markdown: z
    .string()
    .max(32768)
    .optional()
    .describe("Rich message in GFM Markdown"),
  html: z.string().max(32768).optional().describe("Rich message in HTML"),
  is_rtl: z.boolean().optional().describe("Right-to-left layout"),
  skip_entity_detection: z
    .boolean()
    .optional()
    .describe("Skip auto-detection of URLs, mentions, hashtags"),
};

function withParseMode(parse_mode?: string) {
  return parse_mode ? { parse_mode } : {};
}

function buildRichMessage(args: {
  markdown?: string;
  html?: string;
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}) {
  const { markdown, html, is_rtl, skip_entity_detection } = args;
  if (!markdown && !html) {
    throw new Error("Either markdown or html is required for rich messages");
  }
  if (markdown && html) {
    throw new Error("Provide only one of markdown or html, not both");
  }
  return {
    ...(markdown ? { markdown } : {}),
    ...(html ? { html } : {}),
    ...(is_rtl !== undefined ? { is_rtl } : {}),
    ...(skip_entity_detection !== undefined ? { skip_entity_detection } : {}),
  };
}

export function createMcpServer(telegram: TelegramConfig): McpServer {
  const { botToken } = telegram;

  async function tg<T>(method: string, body: Record<string, unknown>) {
    return telegramCall<T>(botToken, method, body);
  }

  const server = new McpServer({
    name: "telegram-notify",
    version: "1.4.0",
  });

  // ponytail: MCP+zod TS2589 — schemas match upstream telegram-notify-mcp at runtime
  // @ts-expect-error TS2589 type instantiation depth
  server.tool(
    "send_notification",
    "Send a text notification to Telegram (sendMessage). Supports HTML, MarkdownV2, or legacy Markdown via parse_mode.",
    {
      text: z.string().min(1).max(4096).describe("Message text"),
      chat_id: chatIdSchema,
      silent: silentSchema,
      parse_mode: parseModeSchema,
    },
    async ({ text, chat_id, silent, parse_mode }) => {
      const result = await tg<{ message_id: number }>("sendMessage", {
        chat_id: resolveChatId(telegram, chat_id),
        text,
        disable_notification: silent ?? false,
        ...withParseMode(parse_mode),
      });
      return {
        content: [
          { type: "text" as const, text: `Sent. message_id=${result.message_id}` },
        ],
      };
    },
  );

  // ponytail: MCP+zod TS2589 — schemas match upstream telegram-notify-mcp at runtime
  server.tool(
    "send_draft",
    "Stream partial message while agent is working (sendMessageDraft). Ephemeral ~30s preview — finalize with send_notification.",
    {
      draft_id: z.number().int().min(1).max(10).describe("Draft slot ID (1-10)"),
      text: z.string().max(4096).describe("Current draft text"),
      chat_id: chatIdSchema,
      parse_mode: parseModeSchema,
    },
    async ({ draft_id, text, chat_id, parse_mode }) => {
      await tg("sendMessageDraft", {
        chat_id: resolveChatId(telegram, chat_id),
        draft_id,
        text,
        ...withParseMode(parse_mode),
      });
      return {
        content: [{ type: "text" as const, text: `Draft ${draft_id} updated` }],
      };
    },
  );

  // ponytail: MCP+zod TS2589 — schemas match upstream telegram-notify-mcp at runtime
  server.tool(
    "send_rich_message",
    "Send a rich formatted message (sendRichMessage). Use markdown or html.",
    {
      ...richContentSchema,
      chat_id: chatIdSchema,
      silent: silentSchema,
    },
    async ({ markdown, html, is_rtl, skip_entity_detection, chat_id, silent }) => {
      const result = await tg<{ message_id: number }>("sendRichMessage", {
        chat_id: resolveChatId(telegram, chat_id),
        rich_message: buildRichMessage({
          markdown,
          html,
          is_rtl,
          skip_entity_detection,
        }),
        disable_notification: silent ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Rich message sent. message_id=${result.message_id}`,
          },
        ],
      };
    },
  );

  // ponytail: MCP+zod TS2589 — schemas match upstream telegram-notify-mcp at runtime
  server.tool(
    "send_rich_draft",
    "Stream partial rich message while agent is working (sendRichMessageDraft).",
    {
      draft_id: z.number().int().min(1).max(10).describe("Draft slot ID (1-10)"),
      ...richContentSchema,
      chat_id: chatIdSchema,
    },
    async ({
      draft_id,
      markdown,
      html,
      is_rtl,
      skip_entity_detection,
      chat_id,
    }) => {
      await tg("sendRichMessageDraft", {
        chat_id: resolveChatId(telegram, chat_id),
        draft_id,
        rich_message: buildRichMessage({
          markdown,
          html,
          is_rtl,
          skip_entity_detection,
        }),
      });
      return {
        content: [
          { type: "text" as const, text: `Rich draft ${draft_id} updated` },
        ],
      };
    },
  );

  // ponytail: MCP+zod TS2589 — schemas match upstream telegram-notify-mcp at runtime
  // @ts-expect-error TS2589 type instantiation depth
  server.tool(
    "send_chat_action",
    "Show typing/upload status in Telegram (sendChatAction). Status lasts ~5 seconds.",
    {
      action: z
        .enum([
          "typing",
          "upload_photo",
          "record_video",
          "upload_video",
          "record_voice",
          "upload_voice",
          "upload_document",
          "choose_sticker",
          "find_location",
          "record_video_note",
          "upload_video_note",
        ])
        .describe("Action type"),
      chat_id: chatIdSchema,
    },
    async ({ action, chat_id }) => {
      await tg("sendChatAction", {
        chat_id: resolveChatId(telegram, chat_id),
        action,
      });
      return {
        content: [{ type: "text" as const, text: `Chat action '${action}' sent` }],
      };
    },
  );

  return server;
}
