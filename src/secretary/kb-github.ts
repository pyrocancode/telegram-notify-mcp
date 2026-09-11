import type { Env } from "../env";

type GhTree = { tree?: { path?: string; type?: string }[] };
type GhSearch = {
  items?: { path?: string; text_matches?: { fragment?: string }[] }[];
};

function ghHeaders(token: string, extra?: Record<string, string>): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "telegram-notify-mcp",
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function underPrefix(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export async function kbSearch(
  env: Env,
  query: string,
): Promise<string> {
  if (!env.secretaryKbGithub || !env.githubToken) {
    return "База не настроена: SECRETARY_KB_GITHUB и GITHUB_TOKEN.";
  }
  const q = query.trim().slice(0, 200);
  if (!q) return "Пустой запрос.";
  const repo = env.secretaryKbGithub;
  const prefix = env.secretaryKbGithubPath;
  const token = env.githubToken;

  const searchRes = await fetch(
    `https://api.github.com/search/code?q=${encodeURIComponent(`${q} repo:${repo} extension:md`)}`,
    {
      headers: ghHeaders(token, {
        Accept: "application/vnd.github.text-match+json",
      }),
    },
  );
  if (searchRes.ok) {
    const data = (await searchRes.json()) as GhSearch;
    const lines = (data.items ?? [])
      .filter((it) => it.path && underPrefix(it.path, prefix))
      .slice(0, 8)
      .map((it) => {
        const snip = it.text_matches?.[0]?.fragment?.replace(/\s+/g, " ").slice(0, 240);
        return snip ? `${it.path}: ${snip}` : it.path!;
      });
    if (lines.length) return lines.join("\n");
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(env.secretaryKbGithubRef)}?recursive=1`,
    { headers: ghHeaders(token) },
  );
  if (!treeRes.ok) return `Поиск недоступен (${searchRes.status}/${treeRes.status}).`;
  const tree = (await treeRes.json()) as GhTree;
  const needle = q.toLowerCase();
  const paths = (tree.tree ?? [])
    .filter((n) => n.type === "blob" && n.path?.endsWith(".md"))
    .map((n) => n.path!)
    .filter((p) => underPrefix(p, prefix) && p.toLowerCase().includes(needle))
    .slice(0, 12);
  if (!paths.length) return "Ничего не нашёл. Уточни запрос или kb_read по пути.";
  return paths.join("\n");
}

export async function kbRead(env: Env, path: string): Promise<string> {
  if (!env.secretaryKbGithub || !env.githubToken) {
    return "База не настроена: SECRETARY_KB_GITHUB и GITHUB_TOKEN.";
  }
  const clean = path.replace(/^\/+/, "").slice(0, 256);
  if (!clean.endsWith(".md") || clean.includes("..")) {
    return "Можно читать только .md внутри базы.";
  }
  if (!underPrefix(clean, env.secretaryKbGithubPath)) {
    return "Файл вне папки базы.";
  }
  const res = await fetch(
    `https://api.github.com/repos/${env.secretaryKbGithub}/contents/${clean}?ref=${encodeURIComponent(env.secretaryKbGithubRef)}`,
    {
      headers: ghHeaders(env.githubToken, {
        Accept: "application/vnd.github.raw",
      }),
    },
  );
  if (!res.ok) return `Не прочитал ${clean} (${res.status}).`;
  return (await res.text()).slice(0, 8000);
}

if (require.main === module) {
  console.assert(underPrefix("a/b.md", "") === true, "empty prefix");
  console.assert(underPrefix("grill/menu.md", "grill") === true, "in folder");
  console.assert(underPrefix("other.md", "grill") === false, "outside");
  console.log("kb-github ok");
}
