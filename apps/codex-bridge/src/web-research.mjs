const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_ANSWER_CHARS = 24_000;
const MAX_CONTEXT_CHARS = 600;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

function cleanBaseUrl(value) {
  return (asText(value) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function safeHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceContext(text, annotation) {
  const start = Number(annotation?.start_index);
  const end = Number(annotation?.end_index);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return "";
  return text.slice(start, Math.min(end, start + MAX_CONTEXT_CHARS)).trim();
}

function collectMessages(payload) {
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content);
    }
  }
  return parts;
}

/** Convert the Responses API output into the stable, UI-facing research envelope. */
export function normalizeWebResearch(payload, { kind, query, url, maxResults, durationMs }) {
  const messages = collectMessages(payload);
  const answer = messages.map((part) => part.text).join("\n\n").trim().slice(0, MAX_ANSWER_CHARS);
  const byUrl = new Map();

  const addSource = (source) => {
    const sourceUrl = asText(source?.url);
    if (!sourceUrl || byUrl.has(sourceUrl)) return;
    byUrl.set(sourceUrl, {
      title: asText(source?.title) || safeHostname(sourceUrl) || sourceUrl,
      url: sourceUrl,
      ...(asText(source?.context) ? { context: asText(source.context).slice(0, MAX_CONTEXT_CHARS) } : {}),
    });
  };

  for (const part of messages) {
    for (const annotation of Array.isArray(part.annotations) ? part.annotations : []) {
      const citation = annotation?.type === "url_citation" ? annotation : annotation?.url_citation;
      if (!citation) continue;
      addSource({
        url: citation.url,
        title: citation.title,
        context: sourceContext(part.text, citation),
      });
    }
  }

  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "web_search_call") continue;
    for (const source of Array.isArray(item.action?.sources) ? item.action.sources : []) addSource(source);
  }

  const allSources = [...byUrl.values()];
  return {
    kind,
    ...(query ? { query } : {}),
    ...(url ? { url } : {}),
    answer,
    sources: allSources.slice(0, maxResults),
    result_count: allSources.length,
    duration_ms: Math.max(0, Math.round(durationMs)),
    response_id: asText(payload?.id),
    model: asText(payload?.model),
  };
}

export class OpenAIWebResearch {
  constructor({ apiKey, fetchImpl = globalThis.fetch, baseUrl, model } = {}) {
    this.apiKey = asText(apiKey) || asText(process.env.CODEX_API_KEY) || asText(process.env.OPENAI_API_KEY);
    this.fetchImpl = fetchImpl;
    this.baseUrl = cleanBaseUrl(baseUrl || process.env.APEX_OPENAI_BASE_URL);
    this.model = asText(model) || asText(process.env.APEX_WEB_SEARCH_MODEL) || DEFAULT_MODEL;
  }

  async request({ kind, query, url, allowedDomains = [], maxResults = 8 }) {
    if (!this.apiKey) throw new Error("OpenAI API key is not available to the APEX research runtime");
    const started = Date.now();
    const exactHost = url ? safeHostname(url) : "";
    const domains = [...new Set([...(exactHost ? [exactHost] : []), ...allowedDomains.map(asText).filter(Boolean)])];
    const webTool = {
      type: "web_search",
      ...(domains.length ? { filters: { allowed_domains: domains.slice(0, 20) } } : {}),
    };
    const task = kind === "fetch"
      ? `Open this exact URL and summarize the page's claims and evidence: ${url}\nDo not substitute a different page. Cite the page and any directly consulted supporting sources.`
      : `Search the live web for: ${query}\nReturn a concise evidence-focused answer. Cite every factual claim with the consulted sources.`;
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: task,
        tools: [webTool],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        max_output_tokens: 1600,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = asText(payload?.error?.message) || `OpenAI web research failed with HTTP ${response.status}`;
      throw new Error(message.slice(0, 1000));
    }
    return normalizeWebResearch(payload, {
      kind,
      query,
      url,
      maxResults,
      durationMs: Date.now() - started,
    });
  }

  search(input) {
    return this.request({ kind: "search", ...input });
  }

  fetch(input) {
    return this.request({ kind: "fetch", ...input });
  }
}
