import { Agent, type AgentOptions } from "@cursor/sdk";

type SharedAgentInput = {
  apiKey: string;
  workspaceName: string;
  agentId?: string;
  model: string;
  cloud: AgentOptions["cloud"];
  mcpServers: AgentOptions["mcpServers"];
};

/** ponytail: first name match wins; duplicate titles need manual CURSOR_AGENT_ID */
export function pickAgentByName<
  T extends { name: string; lastModified: number; archived?: boolean },
>(items: T[], workspaceName: string): T | undefined {
  return items
    .filter((a) => a.name === workspaceName && !a.archived)
    .sort((a, b) => b.lastModified - a.lastModified)[0];
}

export async function resolveSharedAgent(
  opts: SharedAgentInput,
  onWarn?: (msg: string) => void,
) {
  const base: Partial<AgentOptions> = {
    apiKey: opts.apiKey,
    mcpServers: opts.mcpServers,
  };

  if (opts.agentId) {
    try {
      return await Agent.resume(opts.agentId, base);
    } catch {
      onWarn?.(`resume ${opts.agentId} failed, searching "${opts.workspaceName}"`);
    }
  }

  let cursor: string | undefined;
  do {
    const page = await Agent.list({
      runtime: "cloud",
      apiKey: opts.apiKey,
      limit: 50,
      cursor,
    });
    const hit = pickAgentByName(page.items, opts.workspaceName);
    if (hit) {
      return Agent.resume(hit.agentId, base);
    }
    cursor = page.nextCursor;
  } while (cursor);

  return Agent.create({
    ...base,
    name: opts.workspaceName,
    model: { id: opts.model },
    // ponytail: name = agent title in Cursor UI; cloud.env.name is a separate pre-provisioned env
    cloud: opts.cloud,
  });
}

if (require.main === module) {
  const hit = pickAgentByName(
    [
      { name: "grill", lastModified: 1, archived: false },
      { name: "grill", lastModified: 99, archived: false },
      { name: "other", lastModified: 100, archived: false },
    ],
    "grill",
  );
  if (!hit || hit.lastModified !== 99) throw new Error("pickAgentByName failed");
  console.log("resolve-shared-agent ok");
}
