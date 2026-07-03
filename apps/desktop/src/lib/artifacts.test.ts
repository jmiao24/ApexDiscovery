import { describe, expect, it } from "vitest";
import type { ToolUpdatedEvent } from "@ai4s/sdk";
import type { ArtifactInspector } from "@ai4s/shared";
import {
  artifactBlockToInspector,
  deriveArtifact,
  extractArtifactRefs,
  extToKind,
  fileInspectorFromBlock,
  previewKind,
  refToArtifactBlock,
  resolveArtifactContent,
} from "./artifacts";

const write = (input: Record<string, unknown>, over: Partial<ToolUpdatedEvent> = {}): ToolUpdatedEvent => ({
  type: "tool.updated",
  sessionId: "s",
  callId: "c",
  tool: "write",
  status: "success",
  input,
  ...over,
});

describe("extToKind", () => {
  it("maps extensions to kinds and defaults unknown to data", () => {
    expect(extToKind("png")).toBe("figure");
    expect(extToKind("PY")).toBe("script");
    expect(extToKind("csv")).toBe("table");
    expect(extToKind("ipynb")).toBe("notebook");
    expect(extToKind("pdf")).toBe("report");
    expect(extToKind("xyz")).toBe("data");
  });
});

describe("deriveArtifact", () => {
  it("derives a script artifact with content + language from a write tool", () => {
    const a = deriveArtifact(write({ filePath: "src/make_fig.py", content: "print(1)" }));
    expect(a).toMatchObject({
      kind: "artifact",
      filename: "make_fig.py",
      artifact: "script",
      tool: "write",
      content: "print(1)",
      language: "python",
    });
  });

  it("classifies an image write as a figure (no text content required)", () => {
    const a = deriveArtifact(write({ path: "figures/atlas.png" }));
    expect(a?.artifact).toBe("figure");
    expect(a?.filename).toBe("atlas.png");
    expect(a?.content).toBeUndefined();
  });

  it("returns null for non-write tools, failures, and missing paths", () => {
    expect(deriveArtifact(write({ filePath: "a.py" }, { tool: "bash" }))).toBeNull();
    expect(deriveArtifact(write({ filePath: "a.py" }, { status: "running" }))).toBeNull();
    expect(deriveArtifact(write({ content: "x" }))).toBeNull();
  });
});

describe("resolveArtifactContent", () => {
  const data: ArtifactInspector = {
    variant: "artifact",
    title: "fig.py",
    versions: [
      { label: "v1", code: "old", reviewPassed: false },
      { label: "v2" },
    ],
    activeVersion: "v2",
    reviewPassed: true,
    inputs: [],
    code: "new",
    language: "python",
  };

  it("uses the version override when present", () => {
    const r = resolveArtifactContent(data, "v1");
    expect(r.code).toBe("old");
    expect(r.reviewPassed).toBe(false);
  });

  it("falls back to inspector-level fields when the version omits them", () => {
    const r = resolveArtifactContent(data, "v2");
    expect(r.code).toBe("new");
    expect(r.reviewPassed).toBe(true);
  });
});

describe("extractArtifactRefs", () => {
  it("finds files produced by running code, even in prose/backticks", () => {
    const md = "Generated `canvas-project/canvas.pdf` (A4) and a preview at report/index.html.";
    expect(extractArtifactRefs(md)).toEqual(["canvas-project/canvas.pdf", "report/index.html"]);
  });

  it("dedupes and ignores URLs", () => {
    const md = "See figs/a.png and figs/a.png, not https://example.com/b.png";
    expect(extractArtifactRefs(md)).toEqual(["figs/a.png"]);
  });

  it("returns nothing when no artifact-like paths are present", () => {
    expect(extractArtifactRefs("just a sentence about e.g. things")).toEqual([]);
  });

  it("finds Office documents (docx/xlsx/pptx)", () => {
    const md = "Wrote project.docx, project.xlsx and project.pptx.";
    expect(extractArtifactRefs(md)).toEqual(["project.docx", "project.xlsx", "project.pptx"]);
  });
});

describe("previewKind", () => {
  it("maps extensions to a preview strategy", () => {
    expect(previewKind("html")).toBe("html");
    expect(previewKind("pdf")).toBe("pdf");
    expect(previewKind("png")).toBe("image");
    expect(previewKind("svg")).toBe("image");
    expect(previewKind("py")).toBe("text");
  });

  it("gives Office documents their own inline preview kinds", () => {
    expect(previewKind("docx")).toBe("docx");
    expect(previewKind("xlsx")).toBe("xlsx");
    expect(previewKind("pptx")).toBe("pptx");
  });
});

describe("refToArtifactBlock", () => {
  it("builds a path-only artifact block from a mentioned file", () => {
    expect(refToArtifactBlock("canvas-project/canvas.pdf")).toMatchObject({
      kind: "artifact",
      path: "canvas-project/canvas.pdf",
      filename: "canvas.pdf",
      artifact: "report",
      tool: "output",
    });
  });
});

describe("artifactBlockToInspector", () => {
  it("shows text content for a text artifact", () => {
    const insp = artifactBlockToInspector({
      kind: "artifact",
      path: "a.py",
      filename: "a.py",
      artifact: "script",
      tool: "write",
      content: "print(1)",
      language: "python",
    });
    expect(insp.code).toBe("print(1)");
    expect(insp.language).toBe("python");
  });

  it("routes .ipynb artifacts to the runnable notebook editor, others to file preview", () => {
    const nb = fileInspectorFromBlock({
      kind: "artifact",
      path: "analysis/run.ipynb",
      filename: "run.ipynb",
      artifact: "notebook",
      tool: "write",
    });
    expect(nb).toEqual({ variant: "notebook-file", path: "analysis/run.ipynb" });

    const file = fileInspectorFromBlock({
      kind: "artifact",
      path: "fig.png",
      filename: "fig.png",
      artifact: "figure",
      tool: "write",
    });
    expect(file.variant).toBe("file");
  });

  it("shows a placeholder for a binary artifact", () => {
    const insp = artifactBlockToInspector({
      kind: "artifact",
      path: "figures/atlas.png",
      filename: "atlas.png",
      artifact: "figure",
      tool: "write",
    });
    expect(insp.code).toContain("Binary artifact");
    expect(insp.code).toContain("figures/atlas.png");
  });
});
