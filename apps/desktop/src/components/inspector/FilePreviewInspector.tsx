import { useEffect, useState } from "react";
import { Code2, Eye, ExternalLink, History, Loader2, X } from "lucide-react";
import type { FilePreviewInspector as FilePreviewInspectorT } from "@ai4s/shared";
import { extOf, previewKind, type PreviewKind } from "@/lib/artifacts";
import { base64ToBytes, openArtifactExternally, previewUrl, readArtifact } from "@/lib/artifactFile";
import { parseTableFile } from "@/lib/csv";
import { CodeViewer } from "@/components/code-viewer/CodeViewer";
import { ProvenancePanel } from "./ProvenancePanel";
import { TablePreview } from "./TablePreview";
import { DocxView, PptxView, XlsxView } from "./OfficePreview";
import { MoleculeView } from "./MoleculeView";
import { cn } from "@/lib/cn";

/**
 * Right-pane preview for any workspace file. Strategy (no format conversion):
 * pdf / image / html — served from the local file server (http://127.0.0.1)
 * and rendered by the webview's NATIVE viewers via <iframe>/<img>;
 * csv/tsv — parsed to a table; docx/xlsx/pptx — local JS renderers fed raw
 * bytes; everything else — code/text.
 */
export function FilePreviewInspector({
  data,
  onClose,
}: {
  data: FilePreviewInspectorT;
  onClose: () => void;
}) {
  const ext = extOf(data.filename);
  const kind = previewKind(ext);
  const needsUrl = kind === "pdf" || kind === "image" || kind === "html";
  const needsText = kind === "table" || kind === "text" || kind === "html" || kind === "molecule";
  const needsBytes = kind === "docx" || kind === "xlsx" || kind === "pptx";

  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(data.content ?? null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">(kind === "text" ? "code" : "preview");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    (async () => {
      try {
        if (needsUrl) {
          const u = await previewUrl(data.path);
          if (cancelled) return;
          setUrl(u);
          // Browser dev has no local server; html can still preview inline content.
          if (!u && kind !== "html") {
            setError("Preview is available in the desktop app.");
          }
        }
        if (needsText && data.content === undefined) {
          const f = await readArtifact(data.path);
          if (cancelled) return;
          if (f && f.encoding === "utf8") setText(f.data);
          else if (!f && kind !== "html") setError("Preview is available in the desktop app.");
        }
        if (needsBytes) {
          const f = await readArtifact(data.path);
          if (cancelled) return;
          if (f && f.encoding === "base64") setBytes(base64ToBytes(f.data));
          else setError("Preview is available in the desktop app.");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.path, data.content, kind, needsUrl, needsText, needsBytes]);

  const canToggle = kind === "html" || kind === "molecule";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text">{data.filename}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{data.artifact}</span>
        {canToggle && (
          <div className="ml-2 flex items-center gap-1 rounded-input bg-surface-2 p-0.5">
            <ToggleBtn active={tab === "preview"} onClick={() => setTab("preview")}>
              <Eye size={13} /> Preview
            </ToggleBtn>
            <ToggleBtn active={tab === "code"} onClick={() => setTab("code")}>
              <Code2 size={13} /> Code
            </ToggleBtn>
          </div>
        )}
        <div className="flex-1" />
        <button
          className={cn(showHistory ? "text-text" : "text-muted hover:text-text")}
          aria-label="History"
          title="History — every recorded version with its code and conversation"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          <History size={16} />
        </button>
        <button
          className="text-muted hover:text-text"
          aria-label="Open externally"
          title="Open in the default app"
          onClick={() => void openArtifactExternally(data.path)}
        >
          <ExternalLink size={16} />
        </button>
        <button className="text-muted hover:text-text" aria-label="Close inspector" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-surface-2">
        {showHistory && <ProvenancePanel path={data.path} language={data.language} />}
        {!showHistory && loading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Loading {data.filename}…
          </div>
        )}
        {!showHistory && !loading && error && <div className="p-4 text-sm text-muted">{error}</div>}
        {!showHistory && !loading && !error && (
          <Body
            kind={kind}
            url={url}
            text={text}
            bytes={bytes}
            showCode={tab === "code"}
            filename={data.filename}
            language={data.language}
          />
        )}
      </div>
    </div>
  );
}

function Body({
  kind,
  url,
  text,
  bytes,
  showCode,
  filename,
  language,
}: {
  kind: PreviewKind;
  url: string | null;
  text: string | null;
  bytes: ArrayBuffer | null;
  showCode: boolean;
  filename: string;
  language?: string;
}) {
  if (kind === "docx" || kind === "xlsx" || kind === "pptx") {
    if (!bytes) return <Note text="Preview is available in the desktop app." />;
    if (kind === "docx") return <DocxView bytes={bytes} />;
    if (kind === "xlsx") return <XlsxView bytes={bytes} />;
    return <PptxView bytes={bytes} />;
  }
  if (kind === "molecule") {
    if (showCode) {
      return text !== null ? (
        <div className="p-3">
          <CodeViewer code={text} language={language} />
        </div>
      ) : (
        <Note text="Source is available in the desktop app." />
      );
    }
    return text !== null ? (
      <MoleculeView filename={filename} text={text} />
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === "html" && showCode) {
    return text !== null ? (
      <div className="p-3">
        <CodeViewer code={text} language="html" />
      </div>
    ) : (
      <Note text="Source is available in the desktop app." />
    );
  }
  if (kind === "html") {
    // Served URL preferred (relative assets resolve); srcdoc as browser fallback.
    if (url) {
      return <iframe title="HTML preview" src={url} sandbox="allow-scripts" className="h-full min-h-[480px] w-full bg-white" />;
    }
    if (text !== null) {
      return <iframe title="HTML preview" srcDoc={text} sandbox="allow-scripts" className="h-full min-h-[480px] w-full bg-white" />;
    }
    return <Note text="Preview is available in the desktop app." />;
  }
  if (kind === "pdf") {
    // The webview's native PDF viewer (WKWebView / WebView2) renders the served URL.
    return url ? (
      <iframe title="PDF preview" src={url} className="h-full min-h-[480px] w-full" />
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === "image") {
    return url ? (
      <div className="flex justify-center p-4">
        <img src={url} alt={filename} className="max-w-full rounded-sm bg-white shadow-card" />
      </div>
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === "table") {
    return text !== null ? (
      <TablePreview table={parseTableFile(filename, text)} />
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  return text !== null ? (
    <div className="p-3">
      <CodeViewer code={text} language={language} />
    </div>
  ) : (
    <Note text="Preview is available in the desktop app." />
  );
}

function Note({ text }: { text: string }) {
  return <div className="p-4 text-sm text-muted">{text}</div>;
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs",
        active ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
