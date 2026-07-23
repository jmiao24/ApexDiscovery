import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexExecutable, workspaceSandboxInvocation } from "./codex-sandbox.mjs";

test("resolves the Codex executable bundled through the SDK", () => {
  assert.match(resolveCodexExecutable(), /codex(?:\.exe)?$/);
});

test("builds a managed workspace sandbox invocation without a shell interpolation layer", () => {
  assert.deepEqual(
    workspaceSandboxInvocation({
      cwd: "/workspace/demo",
      file: "/bin/sh",
      args: ["-c", "printf ok"],
      executable: "/opt/codex",
    }),
    {
      file: "/opt/codex",
      args: [
        "sandbox",
        "--permission-profile",
        ":workspace",
        "--include-managed-config",
        "--cd",
        "/workspace/demo",
        "--",
        "/bin/sh",
        "-c",
        "printf ok",
      ],
    },
  );
});
