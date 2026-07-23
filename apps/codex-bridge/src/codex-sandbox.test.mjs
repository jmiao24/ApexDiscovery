import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNetworkDomains,
  resolveCodexExecutable,
  workspaceSandboxInvocation,
} from "./codex-sandbox.mjs";

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

test("normalizes ExecuteCode domains and allows only its private broker socket", () => {
  assert.deepEqual(normalizeNetworkDomains([
    " EUTILS.NCBI.NLM.NIH.GOV. ",
    "**.gxl.ai",
    "eutils.ncbi.nlm.nih.gov",
  ]), ["eutils.ncbi.nlm.nih.gov", "**.gxl.ai"]);
  assert.throws(() => normalizeNetworkDomains(["https://ncbi.nlm.nih.gov/path"]), /Invalid/);
  assert.throws(() => normalizeNetworkDomains(["localhost"]), /Invalid/);

  const invocation = workspaceSandboxInvocation({
    cwd: "/workspace/demo",
    file: "python3",
    args: ["analysis.py"],
    executable: "/opt/codex",
    allowedUnixSockets: ["/private/tmp/apex-network.sock"],
  });
  assert.deepEqual(invocation.args, [
    "sandbox",
    "--permission-profile",
    ":workspace",
    "--include-managed-config",
    "--cd",
    "/workspace/demo",
    "--allow-unix-socket",
    "/private/tmp/apex-network.sock",
    "--",
    "python3",
    "analysis.py",
  ]);
});
