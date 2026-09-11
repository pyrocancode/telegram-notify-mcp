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
  /** HTTPS markdown URLs, comma-separated — stuffed into secretary prompt */
  secretaryKbUrls: string[];
  secretaryKbGithub?: string;
  secretaryKbGithubPath: string;
  secretaryKbGithubRef: string;
  githubToken?: string;
  /** Whisper only */
  openaiApiKey?: string;
  secretaryEnabled: boolean;
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
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  const bridgeEnabled = Boolean(cursorApiKey && webhookSecret && allowedRaw);
  const secretaryEnabled = Boolean(cursorApiKey && webhookSecret);

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
    secretaryEnabled,
    telegramWebhookSecret: webhookSecret,
    cursorModel: process.env.CURSOR_MODEL?.trim() || "composer-2.5",
    cursorWorkspaceName:
      process.env.CURSOR_WORKSPACE_NAME?.trim() || "grill",
    allowedChatIds: new Set<string>(),
    secretaryKbUrls: (process.env.SECRETARY_KB_URLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^https:\/\//i.test(s)),
    secretaryKbGithubPath: (
      process.env.SECRETARY_KB_GITHUB_PATH ?? ""
    ).replace(/^\/+|\/+$/g, ""),
    secretaryKbGithubRef:
      process.env.SECRETARY_KB_GITHUB_REF?.trim() || "main",
  };

  const gh = process.env.SECRETARY_KB_GITHUB?.trim();
  if (gh && /^[\w.-]+\/[\w.-]+$/.test(gh)) env.secretaryKbGithub = gh;
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghToken) env.githubToken = ghToken;

  if (cursorApiKey) env.cursorApiKey = cursorApiKey;

  if (bridgeEnabled) {
    env.allowedChatIds = parseAllowedChatIds(allowedRaw!);
    const agentId = process.env.CURSOR_AGENT_ID?.trim();
    if (agentId) env.cursorAgentId = agentId;
  }

  const repoUrl = process.env.CURSOR_REPO_URL?.trim();
  if (repoUrl) {
    env.cursorRepoUrl = repoUrl;
    env.cursorRepoRef = process.env.CURSOR_REPO_REF?.trim() || "main";
  }

  if (openaiApiKey) env.openaiApiKey = openaiApiKey;

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
    console.log("env ok", {
      bridge: env.bridgeEnabled,
      secretary: env.secretaryEnabled,
      mcp: mcpUrl(env),
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
