#!/usr/bin/env node
import { createServer } from "node:http";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Codex } from "@openai/codex-sdk";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8767);
const HOST = process.env.HOST || "127.0.0.1";
const HTML_PATH = join(ROOT, "results/prod_batch_001/viz/showcase.html");
const DATA_PATH = join(ROOT, "results/prod_batch_001/viz/showcase_data.json");
const MCP_PATH = join(ROOT, "biologic-universe-mcp.mjs");
const HISTORY_DIR = join(ROOT, "data");
const HISTORY_PATH = process.env.BIOLOGIC_UNIVERSE_HISTORY_PATH || join(HISTORY_DIR, "chat-history.sqlite");
const DATASET_VERSION = "prod_batch_001";
const TURN_TIMEOUT_MS = Math.max(30_000, Number(process.env.BIOLOGIC_UNIVERSE_TURN_TIMEOUT_MS) || 180_000);
const conversations = new Map();
const runningConversations = new Set();

await mkdir(dirname(HISTORY_PATH), { recursive: true });
const historyDb = new DatabaseSync(HISTORY_PATH);
historyDb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    codex_thread_id TEXT,
    title TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    context_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expert_questions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT 'Expert input',
    status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'dismissed')) DEFAULT 'pending',
    answer TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_conversation_time
    ON messages(conversation_id, created_at, id);
  CREATE INDEX IF NOT EXISTS conversations_recent
    ON conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS expert_questions_conversation_status
    ON expert_questions(conversation_id, status, created_at);
`);
await chmod(HISTORY_PATH, 0o600).catch(() => {});

const statements = {
  createConversation: historyDb.prepare(`
    INSERT INTO conversations (id, codex_thread_id, title, dataset_version, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?)
  `),
  conversation: historyDb.prepare(`
    SELECT id, codex_thread_id, title, dataset_version, created_at, updated_at
    FROM conversations WHERE id = ?
  `),
  conversations: historyDb.prepare(`
    SELECT c.id, c.title, c.dataset_version, c.created_at, c.updated_at,
           COUNT(m.id) AS message_count
    FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?
  `),
  messages: historyDb.prepare(`
    SELECT id, role, content, context_json, created_at
    FROM messages WHERE conversation_id = ? ORDER BY created_at, id
  `),
  addMessage: historyDb.prepare(`
    INSERT INTO messages (conversation_id, role, content, context_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  expertQuestions: historyDb.prepare(`
    SELECT id, conversation_id, question, topic, status, answer, created_at, resolved_at
    FROM expert_questions WHERE conversation_id = ?
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, created_at DESC
  `),
  expertQuestion: historyDb.prepare(`
    SELECT id, conversation_id, question, topic, status, answer, created_at, resolved_at
    FROM expert_questions WHERE id = ? AND conversation_id = ?
  `),
  addExpertQuestion: historyDb.prepare(`
    INSERT INTO expert_questions (id, conversation_id, question, topic, status, answer, created_at, resolved_at)
    VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)
  `),
  answerExpertQuestion: historyDb.prepare(`
    UPDATE expert_questions SET status = 'answered', answer = ?, resolved_at = ?
    WHERE id = ? AND conversation_id = ? AND status = 'pending'
  `),
  dismissExpertQuestion: historyDb.prepare(`
    UPDATE expert_questions SET status = 'dismissed', resolved_at = ?
    WHERE id = ? AND conversation_id = ? AND status = 'pending'
  `),
  updateConversation: historyDb.prepare(`
    UPDATE conversations SET title = ?, codex_thread_id = ?, updated_at = ? WHERE id = ?
  `),
  renameConversation: historyDb.prepare(`
    UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
  `),
  deleteConversation: historyDb.prepare("DELETE FROM conversations WHERE id = ?"),
};

const SYSTEM_PROMPT = `You are the Biologic Universe Agent, a collaborative research partner embedded in a biologic asset dashboard.
Use BiologicUniverseQuery for every claim about this dataset. Do not use shell, filesystem, web search, or outside knowledge.
The dashboard is a fixed research snapshot, not a complete current-market database. Distinguish observed dataset facts from interpretation.
When Dashboard context contains one or more selected assets, targets, modality gaps, or text excerpts, treat those selections as the primary subjects of short follow-up questions such as "Why is this interesting?", "What are the risks?", or "Compare these." Do not ask the user to repeat the selected entities or excerpts. When multiple selections are attached, compare them explicitly and preserve distinctions between them.
Collaborate with the user to compare evidence, surface patterns, test hypotheses, identify uncertainties, and develop promising opportunity ideas. Use inclusive, human-centered language such as "we can compare" or "let's examine" when it sounds natural, while remaining direct and concise. Do not merely agree with the user; clearly flag weak evidence, risks, and alternative interpretations. Cite factual claims at the point where they appear using a short clickable Markdown source name, for example [Phase 2 trial](https://example.org), but only when the snapshot provides a relevant URL. Never repeat a missing-source placeholder.
Treat the user as a subject-matter expert and actively invite their expertise into the analysis. On the first response in a conversation, provide a substantive answer and identify exactly one concise, specific question whose answer could materially improve the next step. Tailor it to the work at hand: ask about a key assumption, preferred analytical direction, methodology, decision criterion, known shortcoming, or domain nuance. Do not ask a generic question such as "Do you have any feedback?" and do not ask the user to restate information already provided. On later turns, create another expert-input question only when the answer would change the analysis; otherwise continue directly. When the user supplies expert input, treat it as attributed expert judgment rather than a verified dataset fact, acknowledge the substance briefly, incorporate it into the next analysis, and make any resulting change in assumptions or direction explicit.
Expert questions are non-blocking and displayed in a separate queue. Never place one in the prose answer. When a useful expert question exists, append exactly one final line in this format: <expert_question topic="Short topic">Question?</expert_question>. Do not use this tag when no useful question exists. The topic must be 2-5 words and the question must be non-leading, answerable, and decision-relevant.
For asset-level tables, attach a compact citation to the most relevant existing cell (for example, "Approved [FDA](https://example.org)" or "Phase 2 [trial](https://example.org)"); do not create a separate Evidence or Sources column. For aggregate tables whose rows are all calculated from this dashboard snapshot, keep the table clean and add one short line after it: "*Source: Biologic Universe research snapshot.*" Do not append a trailing Sources section unless the user explicitly requests one. Never invent or alter a source URL.`;

function codexClient() {
  return new Codex({
    ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
    config: {
      features: { shell_tool: false, multi_agent: false },
      mcp_servers: {
        biologic_universe: {
          command: process.execPath,
          args: [MCP_PATH],
          env: { BIOLOGIC_UNIVERSE_DATA_PATH: DATA_PATH },
          enabled: true,
        },
      },
    },
  });
}

const threadOptions = {
  workingDirectory: ROOT,
  skipGitRepoCheck: true,
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
};

function createConversation(title = "New conversation") {
  const id = randomUUID();
  const now = Date.now();
  statements.createConversation.run(id, title, DATASET_VERSION, now, now);
  return statements.conversation.get(id);
}

function conversationMessages(id) {
  return statements.messages.all(id).map((message) => ({
    ...message,
    context: message.context_json ? JSON.parse(message.context_json) : {},
    context_json: undefined,
  }));
}

function publicExpertQuestion(row) {
  return row ? {
    id: row.id,
    conversation_id: row.conversation_id,
    question: row.question,
    topic: row.topic,
    status: row.status,
    answer: row.answer,
    created_at: Number(row.created_at),
    resolved_at: row.resolved_at == null ? null : Number(row.resolved_at),
  } : null;
}

function conversationExpertQuestions(id) {
  return statements.expertQuestions.all(id).map(publicExpertQuestion);
}

function publicConversation(row, includeMessages = false) {
  if (!row) return null;
  const result = {
    id: row.id,
    title: row.title,
    dataset_version: row.dataset_version,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    ...(row.message_count !== undefined ? { message_count: Number(row.message_count) } : {}),
  };
  if (includeMessages) {
    result.messages = conversationMessages(row.id);
    result.expert_questions = conversationExpertQuestions(row.id);
  }
  return result;
}

function threadFor(row) {
  const cached = conversations.get(row.id);
  if (cached) {
    cached.touched = Date.now();
    return cached.thread;
  }
  const client = codexClient();
  const thread = row.codex_thread_id
    ? client.resumeThread(row.codex_thread_id, threadOptions)
    : client.startThread(threadOptions);
  conversations.set(row.id, { thread, touched: Date.now() });
  return thread;
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function startEventStream(response) {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    connection: "keep-alive",
  });
}

function streamEvent(response, payload) {
  if (!response.writableEnded) response.write(`${JSON.stringify(payload)}\n`);
}

function extractExpertQuestion(finalResponse) {
  const source = String(finalResponse || "");
  const pattern = /<expert_question(?:\s+topic="([^"]{1,80})")?>([\s\S]*?)<\/expert_question>/gi;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return { answer: source.trim(), expertQuestion: null };
  const match = matches.at(-1);
  const question = String(match[2] || "").replace(/\s+/g, " ").trim().slice(0, 600);
  const topic = String(match[1] || "Expert input").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Expert input";
  return {
    answer: source.replace(pattern, "").trim(),
    expertQuestion: question ? { id: randomUUID(), question, topic } : null,
  };
}

function saveCompletedTurn(row, conversationId, thread, result, trace, expertQuestion = null, answeredQuestion = null) {
  const completedAt = Date.now();
  historyDb.exec("BEGIN IMMEDIATE");
  try {
    statements.addMessage.run(
      conversationId,
      "assistant",
      result.finalResponse,
      JSON.stringify({ trace, ...(expertQuestion ? { expert_question: expertQuestion } : {}) }),
      completedAt,
    );
    if (expertQuestion) {
      statements.addExpertQuestion.run(expertQuestion.id, conversationId, expertQuestion.question, expertQuestion.topic, completedAt);
    }
    if (answeredQuestion) {
      statements.answerExpertQuestion.run(answeredQuestion.answer, completedAt, answeredQuestion.id, conversationId);
    }
    statements.updateConversation.run(row.title, thread.id, completedAt, conversationId);
    historyDb.exec("COMMIT");
  } catch (error) {
    historyDb.exec("ROLLBACK");
    throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body exceeds 64 KB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeContext(context) {
  if (!context || typeof context !== "object") return {};
  const text = (value, max = 160) => String(value || "").slice(0, max);
  const list = (value) => (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map((item) => text(item, 120))
    .filter(Boolean);
  const safeSelection = (selection) => ({
    selection_type: text(selection?.selection_type, 40),
    target: text(selection?.target, 80),
    asset_id: text(selection?.asset_id, 120),
    asset_name: text(selection?.asset_name),
    asset_stage: text(selection?.asset_stage, 80),
    modality: text(selection?.modality, 120),
    targets: list(selection?.targets),
    developers: list(selection?.developers),
    gap_modality: text(selection?.gap_modality, 120),
    gap_stage: text(selection?.gap_stage, 120),
    selection_label: text(selection?.selection_label, 120),
    selection_text: text(selection?.selection_text, 2000),
  });
  const rawSelections = Array.isArray(context.selections)
    ? context.selections
    : context.selection_type
      ? [context]
      : [];
  return {
    tab: text(context.tab, 40),
    selections: rawSelections
      .slice(0, 10)
      .map(safeSelection)
      .filter((selection) => selection.selection_type),
  };
}

const FEEDBACK_CATEGORIES = new Set(["add_nuance", "challenge_assumption", "change_direction"]);

function safeFeedback(feedback) {
  if (!feedback || typeof feedback !== "object") return null;
  const text = (value, max) => String(value || "").trim().slice(0, max);
  const category = text(feedback.category, 40);
  const guidance = text(feedback.text, 2000);
  if (!FEEDBACK_CATEGORIES.has(category) || !guidance) return null;
  return {
    category,
    anchor_type: text(feedback.anchor_type, 40),
    anchor_label: text(feedback.anchor_label, 120),
    anchor_text: text(feedback.anchor_text, 1000),
    text: guidance,
  };
}

function safeExpertResponse(questionId, conversationId, answer) {
  const id = String(questionId || "").trim().slice(0, 100);
  if (!id) return null;
  const question = statements.expertQuestion.get(id, conversationId);
  if (!question || question.status !== "pending") return null;
  return {
    id: question.id,
    question: question.question,
    topic: question.topic,
    answer: String(answer || "").trim().slice(0, 4000),
  };
}

const TRACE_OPERATION_LABELS = {
  summary: "Summarized the biologic universe",
  search_assets: "Searched biologic programs",
  target_profile: "Profiled selected targets",
  repurposing: "Screened repurposing candidates",
  modality_gaps: "Mapped modality coverage",
  compare_assets: "Compared selected assets",
  evidence: "Retrieved supporting evidence",
};

function traceSelectionLabel(selection) {
  if (selection.selection_type === "asset") return `Asset · ${selection.asset_name || selection.asset_id || "Selected asset"}`;
  if (selection.selection_type === "target_modality") {
    return `Modality gap · ${selection.target || "Selected target"}${selection.gap_modality ? ` · ${selection.gap_modality}` : ""}`;
  }
  if (selection.selection_type === "target") return `Target · ${selection.target || "Selected target"}`;
  if (selection.selection_type === "text") return `Selected text · ${(selection.selection_text || "").slice(0, 90)}`;
  return "Selected dashboard context";
}

function traceFilters(args = {}) {
  const fields = ["query", "targets", "modalities", "phases", "regions", "stopped", "asset_ids", "limit"];
  return fields.flatMap((field) => {
    const value = args[field];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return [];
    return [[field, Array.isArray(value) ? value.join(", ") : String(value)]];
  });
}

function collectTraceSources(value, sources, seen, depth = 0) {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) collectTraceSources(item, sources, seen, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (typeof value.url === "string" && /^https?:\/\//.test(value.url) && !seen.has(value.url)) {
    seen.add(value.url);
    sources.push({ label: String(value.label || value.source_type || "Supporting source").slice(0, 120), url: value.url });
  }
  for (const child of Object.values(value)) collectTraceSources(child, sources, seen, depth + 1);
}

function traceStepFromItem(item) {
  const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
  const operation = String(args.operation || item.tool || "query");
  const structured = item.result?.structured_content;
  const resultCount = Number.isFinite(Number(structured?.result_count)) ? Number(structured.result_count) : null;
  const queryLimit = structured?.query_limit;
  const filters = traceFilters(args).map(([field, value]) => {
    if (field !== "limit" || !queryLimit?.clamped) return [field, value];
    return [field, `${queryLimit.requested} requested; ${queryLimit.applied} applied`];
  });
  return {
    id: item.id,
    label: TRACE_OPERATION_LABELS[operation] || "Queried the biologic dataset",
    operation,
    status: item.status,
    filters,
    result_count: resultCount,
    error: item.error?.message
      ? String(item.error.message).slice(0, 240)
      : item.status === "failed"
        ? "The dataset operation did not complete."
        : null,
  };
}

function buildTrace(result, context, feedback = null, expertResponse = null) {
  const selections = (context.selections || []).map(traceSelectionLabel);
  const steps = [];
  const sources = [];
  const seenSources = new Set();
  let truncated = false;
  let clamped = false;
  for (const item of result.items || []) {
    if (item.type !== "mcp_tool_call") continue;
    const structured = item.result?.structured_content;
    truncated ||= Boolean(structured?.truncated);
    clamped ||= Boolean(structured?.query_limit?.clamped);
    collectTraceSources(structured, sources, seenSources);
    steps.push(traceStepFromItem(item));
  }
  const citationPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of result.finalResponse.matchAll(citationPattern)) {
    if (seenSources.has(match[2])) continue;
    seenSources.add(match[2]);
    sources.push({ label: match[1].slice(0, 120), url: match[2] });
  }
  const modelRationale = (result.items || [])
    .filter((item) => item.type === "reasoning" && item.text)
    .map((item) => String(item.text).trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1600);
  const completedSteps = steps.filter((step) => step.status === "completed");
  const completedLabels = [...new Set(completedSteps.map((step) => step.label.toLowerCase()))];
  const returnedCounts = completedSteps.map((step) => step.result_count).filter((count) => count != null);
  const fallbackRationale = completedSteps.length
    ? `The response was grounded by ${completedLabels.join(" and ")}. ${returnedCounts.length ? `The completed operations returned ${returnedCounts.join(" and ")} matching record${returnedCounts.some((count) => count !== 1) ? "s" : ""}; ` : ""}the Agent then synthesized those records, the attached dashboard context, and the linked evidence into the stated comparison and conclusions.`
    : "The Agent interpreted the attached dashboard context, but no completed dataset operation was recorded for this turn.";
  const rationale = modelRationale || fallbackRationale;
  const caveats = ["Analysis is bounded to the dashboard’s fixed research snapshot."];
  if (clamped) caveats.push("At least one requested result limit exceeded the safe bound and was automatically capped at 20 records.");
  if (truncated) caveats.push("At least one query returned a bounded subset rather than every matching record.");
  if (!sources.length) caveats.push("No linked source was available for this response in the snapshot.");
  const guidance = feedback ? {
    category: feedback.category,
    anchor_type: feedback.anchor_type,
    anchor_label: feedback.anchor_label,
    anchor_text: feedback.anchor_text,
    text: feedback.text,
  } : null;
  const expert_input = expertResponse ? {
    question_id: expertResponse.id,
    question: expertResponse.question,
    topic: expertResponse.topic,
    answer: expertResponse.answer,
  } : null;
  return { selections, steps, rationale, sources: sources.slice(0, 12), caveats, guidance, expert_input };
}

async function chat(request, response) {
  const body = await readBody(request);
  const message = String(body.message || "").trim();
  if (!message || message.length > 4000) return json(response, 400, { error: "Message must contain 1-4000 characters" });

  let row;
  if (body.conversation_id) {
    row = statements.conversation.get(String(body.conversation_id));
    if (!row) return json(response, 404, { error: "Conversation not found" });
  } else {
    row = createConversation(message.slice(0, 72));
  }
  const conversationId = row.id;
  if (runningConversations.has(conversationId)) {
    return json(response, 409, { conversation_id: conversationId, error: "This conversation is already answering a question" });
  }

  const context = safeContext(body.context);
  const feedback = safeFeedback(body.feedback);
  const expertResponse = safeExpertResponse(body.expert_question_id, conversationId, message);
  if (body.expert_question_id && !expertResponse) {
    return json(response, 409, { error: "This expert question is no longer pending" });
  }
  const initialTurn = !row.codex_thread_id;
  const turnGuidance = initialTurn
    ? "This is the initial response in this conversation. Answer the query first, then queue exactly one tailored question for decision-relevant SME input using the required expert_question tag."
    : "This is a follow-up turn. Queue SME input only if it would materially change the analysis or next step.";
  const feedbackGuidance = feedback
    ? `\n\nExpert guidance: ${JSON.stringify(feedback)}\nTreat this as decision-relevant SME input. Re-evaluate the anchored claim or step, state briefly what changed because of the guidance, and do not merely agree.`
    : "";
  const interviewGuidance = expertResponse
    ? `\n\nExpert interview response: ${JSON.stringify(expertResponse)}\nThis is attributed SME judgment, not a verified dataset fact. Incorporate it critically, say briefly what it changes, and continue the analysis without repeating the question.`
    : "";
  const prompt = `${initialTurn ? `${SYSTEM_PROMPT}\n\n` : ""}Turn guidance: ${turnGuidance}\n\nDashboard context: ${JSON.stringify(context)}${feedbackGuidance}${interviewGuidance}\n\nUser question: ${message}`;
  const now = Date.now();
  statements.addMessage.run(conversationId, "user", message, JSON.stringify({
    ...context,
    ...(feedback ? { feedback } : {}),
    ...(expertResponse ? { interview_response: expertResponse } : {}),
  }), now);
  const thread = threadFor(row);
  runningConversations.add(conversationId);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TURN_TIMEOUT_MS);
  const abortDisconnectedRequest = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", abortDisconnectedRequest);
  response.once("close", abortDisconnectedRequest);

  try {
    const wantsStream = String(request.headers.accept || "").includes("application/x-ndjson");
    if (wantsStream) {
      startEventStream(response);
      streamEvent(response, {
        type: "activity",
        activity: {
          id: "dashboard-context",
          label: context.selections.length
            ? `Reviewing ${context.selections.length} attached selection${context.selections.length === 1 ? "" : "s"}`
            : "Interpreting the research question",
          operation: "context",
          status: "completed",
          filters: [],
          result_count: null,
          error: null,
        },
      });
      if (feedback) {
        streamEvent(response, {
          type: "activity",
          activity: {
            id: "expert-guidance",
            label: "Applying expert guidance",
            operation: "feedback",
            status: "completed",
            filters: [["intent", feedback.category.replaceAll("_", " ")]],
            result_count: null,
            error: null,
          },
        });
      }
      if (expertResponse) {
        streamEvent(response, {
          type: "activity",
          activity: {
            id: "expert-interview",
            label: "Applying expert interview input",
            operation: "expert_input",
            status: "completed",
            filters: [["topic", expertResponse.topic]],
            result_count: null,
            error: null,
          },
        });
      }
      const streamed = await thread.runStreamed(prompt, { signal: controller.signal });
      const items = [];
      let finalResponse = "";
      let usage = null;
      for await (const event of streamed.events) {
        if ((event.type === "item.started" || event.type === "item.updated") && event.item.type === "mcp_tool_call") {
          streamEvent(response, { type: "activity", activity: traceStepFromItem(event.item) });
        }
        if (event.type === "item.completed") {
          items.push(event.item);
          if (event.item.type === "mcp_tool_call") {
            streamEvent(response, { type: "activity", activity: traceStepFromItem(event.item) });
          } else if (event.item.type === "reasoning" && event.item.text) {
            streamEvent(response, { type: "rationale", text: String(event.item.text).slice(0, 1600) });
          } else if (event.item.type === "agent_message") {
            finalResponse = event.item.text;
          }
        }
        if (event.type === "turn.completed") usage = event.usage;
        if (event.type === "turn.failed" || event.type === "error") {
          throw new Error(event.error?.message || event.message || "The Agent turn failed");
        }
      }
      if (!finalResponse) throw new Error("The Agent completed without a final response");
      const parsed = extractExpertQuestion(finalResponse);
      const result = { items, finalResponse: parsed.answer || "Analysis completed.", usage };
      const trace = buildTrace(result, context, feedback, expertResponse);
      saveCompletedTurn(row, conversationId, thread, result, trace, parsed.expertQuestion, expertResponse);
      streamEvent(response, {
        type: "complete",
        conversation_id: conversationId,
        answer: result.finalResponse,
        trace,
        expert_question: parsed.expertQuestion,
      });
      response.end();
      return;
    }
    const rawResult = await thread.run(prompt, { signal: controller.signal });
    const parsed = extractExpertQuestion(rawResult.finalResponse);
    const result = { ...rawResult, finalResponse: parsed.answer || "Analysis completed." };
    const trace = buildTrace(result, context, feedback, expertResponse);
    saveCompletedTurn(row, conversationId, thread, result, trace, parsed.expertQuestion, expertResponse);
    return json(response, 200, {
      conversation_id: conversationId,
      answer: result.finalResponse,
      trace,
      expert_question: parsed.expertQuestion,
    });
  } catch (error) {
    console.error("Chat request failed:", error?.message || error);
    if (response.headersSent) {
      streamEvent(response, {
        type: "error",
        conversation_id: conversationId,
        error: timedOut
          ? `The Agent did not finish within ${Math.round(TURN_TIMEOUT_MS / 60_000)} minutes. Please try a narrower question.`
          : "The local Codex agent could not answer. Confirm that Codex is signed in or set OPENAI_API_KEY, then restart the server.",
      });
      response.end();
      return;
    }
    return json(response, 502, {
      conversation_id: conversationId,
      error: timedOut
        ? `The Agent did not finish within ${Math.round(TURN_TIMEOUT_MS / 60_000)} minutes. Please try a narrower question.`
        : "The local Codex agent could not answer. Confirm that Codex is signed in or set OPENAI_API_KEY, then restart the server.",
    });
  } finally {
    clearTimeout(timeout);
    request.off("aborted", abortDisconnectedRequest);
    response.off("close", abortDisconnectedRequest);
    runningConversations.delete(conversationId);
  }
}

async function conversationsApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/conversations") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
    return json(response, 200, {
      conversations: statements.conversations.all(limit).map((row) => publicConversation(row)),
    });
  }
  if (request.method === "POST" && url.pathname === "/api/conversations") {
    const body = await readBody(request);
    const title = String(body.title || "New conversation").trim().slice(0, 100) || "New conversation";
    return json(response, 201, { conversation: publicConversation(createConversation(title)) });
  }
  const expertListMatch = /^\/api\/conversations\/([^/]+)\/expert-questions$/.exec(url.pathname);
  if (expertListMatch) {
    const id = decodeURIComponent(expertListMatch[1]);
    const row = statements.conversation.get(id);
    if (!row) return json(response, 404, { error: "Conversation not found" });
    if (request.method === "GET") {
      return json(response, 200, { expert_questions: conversationExpertQuestions(id) });
    }
    return false;
  }
  const expertActionMatch = /^\/api\/conversations\/([^/]+)\/expert-questions\/([^/]+)\/dismiss$/.exec(url.pathname);
  if (expertActionMatch) {
    const id = decodeURIComponent(expertActionMatch[1]);
    const questionId = decodeURIComponent(expertActionMatch[2]);
    const row = statements.conversation.get(id);
    if (!row) return json(response, 404, { error: "Conversation not found" });
    if (request.method !== "POST") return false;
    const question = statements.expertQuestion.get(questionId, id);
    if (!question) return json(response, 404, { error: "Expert question not found" });
    statements.dismissExpertQuestion.run(Date.now(), questionId, id);
    return json(response, 200, {
      expert_question: publicExpertQuestion(statements.expertQuestion.get(questionId, id)),
    });
  }
  const match = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
  if (!match) return false;
  const id = decodeURIComponent(match[1]);
  const row = statements.conversation.get(id);
  if (!row) return json(response, 404, { error: "Conversation not found" });
  if (request.method === "GET") {
    return json(response, 200, { conversation: publicConversation(row, true) });
  }
  if (request.method === "PATCH") {
    const body = await readBody(request);
    const title = String(body.title || "").trim().slice(0, 100);
    if (!title) return json(response, 400, { error: "Title must not be empty" });
    statements.renameConversation.run(title, Date.now(), id);
    return json(response, 200, { conversation: publicConversation(statements.conversation.get(id)) });
  }
  if (request.method === "DELETE") {
    if (runningConversations.has(id)) return json(response, 409, { error: "Cannot delete a conversation while it is running" });
    statements.deleteConversation.run(id);
    conversations.delete(id);
    return json(response, 200, { deleted: true });
  }
  return false;
}

async function serveFile(response, path, type) {
  await stat(path);
  response.writeHead(200, {
    "content-type": type,
    "cache-control": type.startsWith("text/html") ? "no-store" : "private, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;",
  });
  response.end(await readFile(path));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, agent: "OpenAI Codex SDK", dataset: DATASET_VERSION, history: "sqlite" });
    }
    if (request.method === "POST" && url.pathname === "/api/chat") return await chat(request, response);
    if (url.pathname === "/api/conversations" || url.pathname.startsWith("/api/conversations/")) {
      const handled = await conversationsApi(request, response, url);
      if (handled !== false) return handled;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/showcase.html")) {
      return await serveFile(response, HTML_PATH, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/showcase_data.json") {
      return await serveFile(response, DATA_PATH, "application/json; charset=utf-8");
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("Request failed:", error?.message || error);
    return json(response, 500, { error: "Internal server error" });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, conversation] of conversations) if (conversation.touched < cutoff) conversations.delete(id);
}, 30 * 60 * 1000).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    historyDb.close();
    server.close(() => process.exit(0));
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Biologic Universe dashboard: http://${HOST}:${PORT}`);
  console.log("Chat authentication: Codex login, or OPENAI_API_KEY when provided");
  console.log(`Conversation history: ${HISTORY_PATH}`);
});
