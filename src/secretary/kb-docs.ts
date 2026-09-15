import type { Env } from "../env";

type DocPage = { path: string; title: string; content: string };

const CACHE_MS = 5 * 60 * 1000;
let cached: { pages: DocPage[]; at: number } | undefined;

function docsEndpoint(raw: string): URL {
  const url = new URL(raw);
  url.pathname = "/llms-full.txt";
  return url;
}

function parsePages(text: string): DocPage[] {
  const blocks = text.split(/(?=^# .+ \(\/docs\/)/m);
  return blocks.flatMap((block) => {
    const match = block.match(/^# (.+?) \((\/docs\/[^)]+)\)\s*\n([\s\S]*)$/);
    if (!match) return [];
    return [{ title: match[1].trim(), path: match[2], content: match[3].trim() }];
  });
}

async function loadPages(env: Env): Promise<DocPage[] | undefined> {
  if (!env.secretaryDocsUrl) return undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.pages;

  const url = docsEndpoint(env.secretaryDocsUrl);
  const first = await fetch(url, { redirect: "manual" });
  let text: string;
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("location");
    if (!location) throw new Error("Documentation redirect has no location");
    const setCookie = first.headers.get("set-cookie");
    const cookie = setCookie?.split(";")[0];
    const second = await fetch(new URL(location, url), {
      headers: cookie ? { Cookie: cookie } : {},
    });
    if (!second.ok) throw new Error(`Documentation unavailable (${second.status})`);
    text = await second.text();
  } else {
    if (!first.ok) throw new Error(`Documentation unavailable (${first.status})`);
    text = await first.text();
  }

  const pages = parsePages(text);
  if (!pages.length) throw new Error("Documentation has no readable LLM pages");
  cached = { pages, at: Date.now() };
  return pages;
}

function words(value: string): string[] {
  return value.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

export async function docsSearch(env: Env, query: string): Promise<string | undefined> {
  const pages = await loadPages(env);
  if (!pages) return undefined;
  const queryWords = words(query);
  if (!queryWords.length) return "Пустой запрос.";
  const result = pages
    .map((page) => {
      const haystack = `${page.title}\n${page.content}`.toLocaleLowerCase("ru");
      const score = queryWords.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
      const index = queryWords.map((word) => haystack.indexOf(word)).find((i) => i >= 0) ?? -1;
      const snippet = index >= 0 ? page.content.slice(Math.max(0, index - 100), index + 260).replace(/\s+/g, " ") : "";
      return { page, score, snippet };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ page, snippet }) => `${page.path}: ${page.title}${snippet ? ` — ${snippet}` : ""}`);
  return result.length ? result.join("\n") : "Ничего не нашёл в документации.";
}

export async function docsRead(env: Env, path: string): Promise<string | undefined> {
  const pages = await loadPages(env);
  if (!pages) return undefined;
  const page = pages.find((item) => item.path === path);
  return page ? `# ${page.title}\n\n${page.content}`.slice(0, 8000) : "Страница не найдена в документации.";
}

if (require.main === module) {
  const pages = parsePages("# Menu (/docs/menu)\n\nPizza\n\n# Team (/docs/team)\n\nPeople");
  console.assert(pages.length === 2 && pages[0].path === "/docs/menu", "parse docs");
  console.log("kb-docs ok");
}
