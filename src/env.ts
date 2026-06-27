export type Env = {
  telegramBotToken: string;
  telegramChatId: string;
  mcpSecret?: string;
  /** Public base URL for self-referencing MCP (e.g. https://telegram-mcp.vercel.app) */
  publicUrl: string;
  bridgeEnabled: boolean;
  telegramWebhookSecret?: string;
  allowedChatIds: Set<string>;
  cursorApiKey?: string;
  cursorModel: string;
  cursorWorkspaceName: string;
  cursorAgentId?: string;
  cursorRepoUrl?: string;
  cursorRepoRef?: string;
};

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseAllowedChatIds(raw: string): Set<string> {
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("ALLOWED_CHAT_IDS is empty");
  return new Set(ids);
}

export function loadEnv(): Env {
  const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const allowedRaw = process.env.ALLOWED_CHAT_IDS?.trim();
  const bridgeEnabled = Boolean(cursorApiKey && webhookSecret && allowedRaw);

  const env: Env = {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramChatId: required("TELEGRAM_CHAT_ID"),
    mcpSecret: process.env.MCP_SECRET?.trim(),
    publicUrl:
      process.env.PUBLIC_URL?.trim() ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
    bridgeEnabled,
    cursorModel: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    cursorWorkspaceName:
      process.env.CURSOR_WORKSPACE_NAME?.trim() || "grill",
    allowedChatIds: new Set<string>(),
  };

  if (bridgeEnabled) {
    env.telegramWebhookSecret = webhookSecret;
    env.allowedChatIds = parseAllowedChatIds(allowedRaw!);
    env.cursorApiKey = cursorApiKey;
    const agentId = process.env.CURSOR_AGENT_ID?.trim();
    if (agentId) env.cursorAgentId = agentId;
  }

  const repoUrl = process.env.CURSOR_REPO_URL?.trim();
  if (repoUrl) {
    env.cursorRepoUrl = repoUrl;
    env.cursorRepoRef = process.env.CURSOR_REPO_REF?.trim() || "main";
  }

  return env;
}

export function mcpUrl(env: Env = loadEnv()): string {
  return `${env.publicUrl.replace(/\/$/, "")}/api/mcp`;
}

// ponytail: assert-based self-check — run via `npm run build && npm run self-check`
if (require.main === module) {
  try {
    const env = loadEnv();
    if (!env.mcpSecret && !env.telegramChatId) {
      throw new Error("Need MCP_SECRET or TELEGRAM_CHAT_ID");
    }
    console.log("env ok", { bridge: env.bridgeEnabled, mcp: mcpUrl(env) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
