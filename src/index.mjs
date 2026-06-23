#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.mjs";

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_CHAT_ID is required");
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
