import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(databasePath) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--no-warnings", "server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      BIOLOGIC_UNIVERSE_HISTORY_PATH: databasePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { child, base };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  throw new Error("server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function api(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

test("conversation CRUD survives a server restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "biologic-universe-history-"));
  const databasePath = join(directory, "history.sqlite");
  let running;
  try {
    running = await startServer(databasePath);
    const created = await api(running.base, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "SOST opportunity review" }),
    });
    const id = created.conversation.id;
    const expertQuestionId = "expert-question-1";
    const database = new DatabaseSync(databasePath);
    database.prepare(`
      INSERT INTO expert_questions (id, conversation_id, question, topic, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(expertQuestionId, id, "Which endpoint matters most to the program decision?", "Decision criteria", Date.now());
    database.close();
    const withQuestion = await api(running.base, `/api/conversations/${id}`);
    assert.equal(withQuestion.conversation.expert_questions.length, 1);
    assert.equal(withQuestion.conversation.expert_questions[0].status, "pending");
    await api(running.base, `/api/conversations/${id}/expert-questions/${expertQuestionId}/dismiss`, { method: "POST" });
    await api(running.base, `/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed SOST review" }),
    });
    await stopServer(running.child);

    running = await startServer(databasePath);
    const restored = await api(running.base, `/api/conversations/${id}`);
    assert.equal(restored.conversation.title, "Renamed SOST review");
    assert.deepEqual(restored.conversation.messages, []);
    assert.equal(restored.conversation.expert_questions[0].status, "dismissed");
    const listed = await api(running.base, "/api/conversations");
    assert.equal(listed.conversations[0].id, id);
    assert.equal(listed.conversations[0].message_count, 0);

    await api(running.base, `/api/conversations/${id}`, { method: "DELETE" });
    const empty = await api(running.base, "/api/conversations");
    assert.deepEqual(empty.conversations, []);
  } finally {
    if (running) await stopServer(running.child);
    await rm(directory, { recursive: true, force: true });
  }
});
