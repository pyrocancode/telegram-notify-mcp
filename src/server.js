import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function telegram(method, body) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description ?? `Telegram API error: ${method}`);
  }
  return data.result;
}

function resolveChatId(chatId) {
  return chatId ?? DEFAULT_CHAT_ID;
}

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
    .describe("Rich message in GFM Markdown (headings, lists, tables, LaTeX)"),
  html: z
    .string()
    .max(32768)
    .optional()
    .describe("Rich message in HTML (headings, lists, tables, LaTeX)"),
  is_rtl: z.boolean().optional().describe("Right-to-left layout"),
  skip_entity_detection: z
    .boolean()
    .optional()
    .describe("Skip auto-detection of URLs, mentions, hashtags"),
};

function buildRichMessage({ markdown, html, is_rtl, skip_entity_detection }) {
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
    ...(skip_entity_detection !== undefined
      ? { skip_entity_detection }
      : {}),
  };
}

function withParseMode(parse_mode) {
  return parse_mode ? { parse_mode } : {};
}

export function createMcpServer() {
  if (!BOT_TOKEN || !DEFAULT_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required");
  }

  const server = new McpServer({
    name: "telegram-notify",
    version: "1.2.0",
  });

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
      const result = await telegram("sendMessage", {
        chat_id: resolveChatId(chat_id),
        text,
        disable_notification: silent ?? false,
        ...withParseMode(parse_mode),
      });
      return {
        content: [
          { type: "text", text: `Sent. message_id=${result.message_id}` },
        ],
      };
    }
  );

  server.tool(
    "send_draft",
    "Stream partial message while agent is working (sendMessageDraft). Ephemeral ~30s preview — finalize with send_notification. Pass empty text for Thinking… placeholder.",
    {
      draft_id: z
        .number()
        .int()
        .min(1)
        .max(10)
        .describe("Draft slot ID (1-10)"),
      text: z
        .string()
        .max(4096)
        .describe(
          "Current draft text (empty string shows Thinking… placeholder)"
        ),
      chat_id: chatIdSchema,
      parse_mode: parseModeSchema,
    },
    async ({ draft_id, text, chat_id, parse_mode }) => {
      await telegram("sendMessageDraft", {
        chat_id: resolveChatId(chat_id),
        draft_id,
        text,
        ...withParseMode(parse_mode),
      });
      return {
        content: [{ type: "text", text: `Draft ${draft_id} updated` }],
      };
    }
  );

  server.tool(
    "send_rich_message",
    "Send a rich formatted message (sendRichMessage). Use markdown or html — supports headings, lists, tables, code blocks, LaTeX, footnotes, media URLs. Up to 32768 chars.",
    {
      ...richContentSchema,
      chat_id: chatIdSchema,
      silent: silentSchema,
    },
    async ({
      markdown,
      html,
      is_rtl,
      skip_entity_detection,
      chat_id,
      silent,
    }) => {
      const result = await telegram("sendRichMessage", {
        chat_id: resolveChatId(chat_id),
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
            type: "text",
            text: `Rich message sent. message_id=${result.message_id}`,
          },
        ],
      };
    }
  );

  server.tool(
    "send_rich_draft",
    "Stream partial rich message while agent is working (sendRichMessageDraft). Ephemeral ~30s preview — finalize with send_rich_message.",
    {
      draft_id: z
        .number()
        .int()
        .min(1)
        .max(10)
        .describe("Draft slot ID (1-10)"),
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
      await telegram("sendRichMessageDraft", {
        chat_id: resolveChatId(chat_id),
        draft_id,
        rich_message: buildRichMessage({
          markdown,
          html,
          is_rtl,
          skip_entity_detection,
        }),
      });
      return {
        content: [{ type: "text", text: `Rich draft ${draft_id} updated` }],
      };
    }
  );

  // ponytail: file_path needs local disk — skip on Vercel (VERCEL=1)
  if (!process.env.VERCEL) {
    server.tool(
      "send_photo",
      "Send a photo file to Telegram",
      {
        file_path: z.string().describe("Absolute path to image file"),
        caption: z.string().max(1024).optional().describe("Photo caption"),
        caption_parse_mode: parseModeSchema.describe("Caption formatting mode"),
        chat_id: chatIdSchema,
        silent: silentSchema,
      },
      async ({ file_path, caption, caption_parse_mode, chat_id, silent }) => {
        const buffer = readFileSync(file_path);
        const blob = new Blob([buffer]);
        const form = new FormData();
        form.append("chat_id", resolveChatId(chat_id));
        form.append("photo", blob, file_path.split("/").pop() ?? "photo.jpg");
        if (caption) form.append("caption", caption);
        if (caption_parse_mode) form.append("parse_mode", caption_parse_mode);
        if (silent) form.append("disable_notification", "true");

        const res = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!data.ok) throw new Error(data.description);
        return {
          content: [
            {
              type: "text",
              text: `Photo sent. message_id=${data.result.message_id}`,
            },
          ],
        };
      }
    );

    server.tool(
      "send_document",
      "Send a document/file to Telegram",
      {
        file_path: z.string().describe("Absolute path to file"),
        caption: z.string().max(1024).optional(),
        caption_parse_mode: parseModeSchema.describe("Caption formatting mode"),
        chat_id: chatIdSchema,
        silent: silentSchema,
      },
      async ({ file_path, caption, caption_parse_mode, chat_id, silent }) => {
        const buffer = readFileSync(file_path);
        const blob = new Blob([buffer]);
        const form = new FormData();
        form.append("chat_id", resolveChatId(chat_id));
        form.append(
          "document",
          blob,
          file_path.split("/").pop() ?? "file.txt"
        );
        if (caption) form.append("caption", caption);
        if (caption_parse_mode) form.append("parse_mode", caption_parse_mode);
        if (silent) form.append("disable_notification", "true");

        const res = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!data.ok) throw new Error(data.description);
        return {
          content: [
            {
              type: "text",
              text: `Document sent. message_id=${data.result.message_id}`,
            },
          ],
        };
      }
    );
  }

  server.tool(
    "send_chat_action",
    "Show typing/upload status in Telegram while the agent is working (sendChatAction). Status lasts ~5 seconds.",
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
        .describe(
          "Action type (typing for text, upload_document for files, etc.)"
        ),
      chat_id: chatIdSchema,
    },
    async ({ action, chat_id }) => {
      await telegram("sendChatAction", {
        chat_id: resolveChatId(chat_id),
        action,
      });
      return {
        content: [{ type: "text", text: `Chat action '${action}' sent` }],
      };
    }
  );

  return server;
}
