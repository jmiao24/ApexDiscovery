import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("bridge did not start");
}

test("bridge exposes only approved skills and MCP config without persisting secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "apex-bridge-"));
  const data = join(root, "data");
  const config = join(root, "config");
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, ".agents", "skills", "native"), { recursive: true });
  writeFileSync(
    join(workspace, ".agents", "skills", "native", "SKILL.md"),
    "---\nname: native\ndescription: Native Codex skill\n---\n",
  );
  mkdirSync(join(workspace, ".agents", "skills", "paperclip"), { recursive: true });
  writeFileSync(
    join(workspace, ".agents", "skills", "paperclip", "SKILL.md"),
    "---\nname: paperclip\ndescription: Search biomedical evidence\n---\n",
  );
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join(here, "server.mjs"), "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/provider`);

    const skills = await fetch(`${base}/api/skill?directory=${encodeURIComponent(workspace)}`).then((r) => r.json());
    const skillNames = [...new Set(skills.data.map((skill) => skill.name))];
    for (const expected of ["cellxgene-census", "dailymed", "depmap", "open-targets", "paperclip"]) {
      assert.ok(skillNames.includes(expected));
    }
    assert.ok(skillNames.every((name) => [
      "assess-disease-expansion",
      "evaluate-label-expansion",
      "paperclip",
      "query-purple-book",
      "imagegen",
      "skill-creator",
      "skill-installer",
      "plugin-creator",
      "depmap",
      "cellxgene-census",
      "dailymed",
      "open-targets",
      "rare-variant-burden",
    ].includes(name)));
    const nativePath = join(workspace, ".agents", "skills", "native", "SKILL.md");
    const hiddenSkillDocument = await fetch(
      `${base}/api/skill/content?directory=${encodeURIComponent(workspace)}&path=${encodeURIComponent(nativePath)}`,
    );
    assert.equal(hiddenSkillDocument.status, 404);
    const paperclipPath = join(workspace, ".agents", "skills", "paperclip", "SKILL.md");
    const skillDocument = await fetch(
      `${base}/api/skill/content?directory=${encodeURIComponent(workspace)}&path=${encodeURIComponent(paperclipPath)}`,
    ).then((r) => r.json());
    assert.equal(skillDocument.data.name, "paperclip");
    assert.match(skillDocument.data.content, /Search biomedical evidence/);
    const arbitraryFile = await fetch(
      `${base}/api/skill/content?directory=${encodeURIComponent(workspace)}&path=${encodeURIComponent(join(workspace, "notes.md"))}`,
    );
    assert.equal(arbitraryFile.status, 404);
    const agents = await fetch(`${base}/agent`).then((r) => r.json());
    assert.deepEqual(agents, [
      {
        name: "literature",
        description: "Independent literature research subagent with Main-equivalent tools and evidence handoff.",
        mode: "subagent",
      },
    ]);

    const initialConfig = await fetch(`${base}/global/config`).then((r) => r.json());
    assert.deepEqual(initialConfig.reviewer, { enabled: false, autoFix: true, maxPasses: 2 });
    await fetch(`${base}/global/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewer: { enabled: false, autoFix: false, maxPasses: 99 } }),
    });
    const updatedConfig = await fetch(`${base}/global/config`).then((r) => r.json());
    assert.deepEqual(updatedConfig.reviewer, { enabled: false, autoFix: false, maxPasses: 2 });

    const created = await fetch(`${base}/session?directory=${encodeURIComponent(workspace)}`, {
      method: "POST",
    }).then((r) => r.json());
    const emptyReview = await fetch(`${base}/session/${created.id}/review_async`, { method: "POST" });
    assert.equal(emptyReview.status, 409);
    assert.match(await emptyReview.text(), /No reviewable artifacts/);

    const secret = "must-not-reach-disk";
    const update = await fetch(`${base}/global/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mcp: {
          papers: {
            type: "local",
            command: ["paper-mcp"],
            environment: { PAPER_TOKEN: secret },
          },
        },
      }),
    });
    assert.equal(update.status, 200);
    const persisted = readFileSync(join(data, "codex-bridge", "config.json"), "utf8");
    assert.doesNotMatch(persisted, new RegExp(secret));
    assert.match(persisted, /\$env:APEX_MCP_PAPERS_PAPER_TOKEN/);

    const status = await fetch(`${base}/mcp`).then((r) => r.json());
    assert.equal(status.papers.status, "pending");
    assert.equal((await fetch(`${base}/mcp/papers`, { method: "DELETE" })).status, 200);
    assert.deepEqual(await fetch(`${base}/mcp`).then((r) => r.json()), {});

    await fetch(`${base}/auth/openai`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "sk-in-memory-only" }),
    });
    assert.doesNotMatch(readFileSync(join(data, "codex-bridge", "config.json"), "utf8"), /sk-in-memory-only/);
    const storeFiles = readdirSync(join(data, "codex-bridge"));
    assert.equal(storeFiles.some((name) => name.endsWith(".tmp")), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a parent session removes its history and hidden subagent sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "apex-bridge-delete-"));
  const data = join(root, "data");
  const config = join(root, "config");
  const store = join(data, "codex-bridge");
  const history = join(store, "history");
  mkdirSync(history, { recursive: true });
  writeFileSync(join(store, "sessions.json"), JSON.stringify({
    ses_parent: { id: "ses_parent", title: "Parent", directory: root, createdAt: 1 },
    ses_child: { id: "ses_child", title: "Child", directory: root, parentId: "ses_parent", createdAt: 2 },
  }));
  writeFileSync(join(history, "ses_parent.json"), "[]");
  writeFileSync(join(history, "ses_child.json"), "[]");

  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join(here, "server.mjs"), "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/provider`);
    const response = await fetch(`${base}/session/ses_parent`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(store, "sessions.json"), "utf8")), {});
    assert.equal(existsSync(join(history, "ses_parent.json")), false);
    assert.equal(existsSync(join(history, "ses_child.json")), false);
    assert.equal(readdirSync(store).some((name) => name.endsWith(".tmp")), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
