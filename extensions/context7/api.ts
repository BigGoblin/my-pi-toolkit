const BASE = "https://context7.com";

export interface LibrarySearchResult {
  id: string;
  title: string;
  description: string;
  trustScore?: number;
  benchmarkScore?: number;
  stars?: number;
  versions?: string[];
}

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function searchLibraries(
  libraryName: string,
  query: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<LibrarySearchResult[]> {
  const url = new URL("/api/v2/libs/search", BASE);
  url.searchParams.set("libraryName", libraryName);
  url.searchParams.set("query", query || libraryName);

  const response = await fetch(url, { headers: authHeaders(apiKey), signal });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Context7 库搜索失败 (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { results?: LibrarySearchResult[] };
  return payload.results ?? [];
}

export async function queryDocs(
  libraryId: string,
  query: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL("/api/v2/context", BASE);
  url.searchParams.set("libraryId", libraryId);
  url.searchParams.set("query", query);

  const response = await fetch(url, { headers: authHeaders(apiKey), signal });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Context7 文档查询失败 (${response.status}): ${body}`);
  }

  return await response.text();
}

export function formatSearchResults(results: LibrarySearchResult[]): string {
  if (results.length === 0) return "未找到匹配的库。";

  return results
    .map((item, index) => {
      const versions = item.versions?.length ? `\n  版本: ${item.versions.slice(0, 5).join(", ")}` : "";
      const scores = [
        item.trustScore !== undefined ? `信任分 ${item.trustScore}` : null,
        item.benchmarkScore !== undefined ? `基准分 ${item.benchmarkScore}` : null,
        item.stars !== undefined && item.stars >= 0 ? `stars ${item.stars}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      return [
        `${index + 1}. ${item.title}`,
        `  ID: ${item.id}`,
        `  描述: ${item.description}`,
        scores ? `  指标: ${scores}` : null,
        versions || null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
