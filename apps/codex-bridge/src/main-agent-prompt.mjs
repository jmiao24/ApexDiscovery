import { readFileSync } from "node:fs";

const promptUrl = new URL("./prompts/apex-biomedical-research-agent.md", import.meta.url);

export const APEX_MAIN_AGENT_PROMPT = readFileSync(promptUrl, "utf8").trim();
