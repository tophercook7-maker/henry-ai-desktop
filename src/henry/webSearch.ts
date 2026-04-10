/**
 * Henry Web Search — DuckDuckGo Instant Answers with CORS fallback.
 * Works in both Electron (direct) and web mode (proxy).
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  abstract?: string;
  abstractUrl?: string;
  answer?: string;
  query: string;
}

function parseDDG(data: Record<string, unknown>, query: string): SearchResponse {
  const results: SearchResult[] = [];

  const topics = (data.RelatedTopics as unknown[]) || [];
  for (const item of topics) {
    const t = item as Record<string, unknown>;
    if (t.FirstURL && t.Text) {
      results.push({
        title: (t.Text as string).slice(0, 100),
        url: t.FirstURL as string,
        snippet: t.Text as string,
      });
    }
    if (t.Topics) {
      for (const sub of (t.Topics as Record<string, unknown>[]) || []) {
        if (sub.FirstURL && sub.Text) {
          results.push({
            title: (sub.Text as string).slice(0, 100),
            url: sub.FirstURL as string,
            snippet: sub.Text as string,
          });
        }
        if (results.length >= 8) break;
      }
    }
    if (results.length >= 8) break;
  }

  return {
    results,
    abstract: (data.AbstractText as string) || undefined,
    abstractUrl: (data.AbstractURL as string) || undefined,
    answer: (data.Answer as string) || undefined,
    query,
  };
}

export async function webSearch(query: string): Promise<SearchResponse> {
  const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  // Direct fetch (works in Electron or CORS-open env)
  try {
    const res = await fetch(ddgUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      return parseDDG(data as Record<string, unknown>, query);
    }
  } catch {
    // try proxy
  }

  // CORS proxy fallback (web mode)
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(ddgUrl)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      return parseDDG(data as Record<string, unknown>, query);
    }
  } catch {
    // both failed
  }

  return {
    results: [],
    query,
    abstract: 'Search unavailable — check network or Ollama host connectivity.',
  };
}

export function formatSearchResultsForHenry(sr: SearchResponse): string {
  const lines: string[] = [`🔍 Web search results for: "${sr.query}"\n`];

  if (sr.answer) {
    lines.push(`**Direct answer:** ${sr.answer}\n`);
  }

  if (sr.abstract) {
    lines.push(`**Summary:** ${sr.abstract}`);
    if (sr.abstractUrl) lines.push(`Source: ${sr.abstractUrl}`);
    lines.push('');
  }

  if (sr.results.length > 0) {
    lines.push('**Related:**');
    for (const r of sr.results.slice(0, 5)) {
      lines.push(`- ${r.snippet}\n  ${r.url}`);
    }
  } else if (!sr.abstract && !sr.answer) {
    lines.push('No results found. Try a different query.');
  }

  return lines.join('\n');
}
