export const APEX_RESEARCH_PROMPT = `## APEX web research tools
Use the apex_research MCP for all web research in this Main Agent thread:
- WebSearch is for discovery queries. WebFetch is for opening one exact HTTP(S) URL returned by a search or supplied by the user.
- human_description is required on every call. Write a distinct 3-8 word action label naming the concrete subject and purpose; never repeat a generic label such as "Searching the web".
- Base factual claims on the returned answer and sources. Preserve source links in the final response so the evidence remains inspectable.
- Do not use shell commands or Python HTTP clients as substitutes for WebSearch or WebFetch.`;

export const CODEX_RESEARCH_PROMPT = `## Codex web research
Use Codex SDK's built-in live web research for current public information:
- Use native web search for discovery queries.
- Open and read exact result URLs when source verification or page retrieval is needed.
- Base factual claims on consulted sources and preserve source links in the final response.
- Do not use shell commands or Python HTTP clients as substitutes for built-in web search.`;

/**
 * Keep every active turn on Codex SDK's native live web stack. This works with
 * ChatGPT-managed Codex auth as well as API-key auth; the dormant APEX MCP can
 * be re-enabled later if its richer structured result envelope is required.
 */
export function researchRoute(_apiKey) {
  return {
    useApexResearch: false,
    webSearchMode: "live",
    prompt: CODEX_RESEARCH_PROMPT,
  };
}
