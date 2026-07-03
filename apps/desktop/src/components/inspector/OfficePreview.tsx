// Inline previews for Office formats, rendered locally (no conversion service):
// docx via docx-preview (HTML), xlsx via SheetJS sheet_to_html (merged cells
// kept), pptx via pptx-preview (inline-styled slide list). Each renderer is
// dynamic-imported so the heavy libraries stay out of the main bundle.
//
// Everything renders inside a Shadow DOM: document content expects plain
// black-on-white browser defaults, and outside it the app's Tailwind preflight
// resets (lists, margins, img sizing) plus the theme's inherited font/colors
// (light text in dark mode) wreck the layout. The shadow root blocks the
// stylesheets; the base style below resets what still inherits.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SheetHtml } from "@/lib/xlsx";

/** Document-neutral canvas: black text, CJK-aware fonts, light gray backdrop. */
const BASE_CSS = `
  :host { display: block; height: 100%; }
  .page {
    min-height: 100%;
    background: #ececec;
    color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: normal;
  }
`;

/** One shadow-isolated container the imperative renderers can append into.
 *  Callback ref, not useRef+useEffect: some views mount the host div late
 *  (after their data loads), and an effect keyed on css would never see it. */
function useShadowPage(extraCss = "") {
  const [page, setPage] = useState<HTMLElement | null>(null);
  const hostRef = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) {
        setPage(null);
        return;
      }
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      shadow.replaceChildren();
      const style = document.createElement("style");
      style.textContent = BASE_CSS + extraCss;
      const div = document.createElement("div");
      div.className = "page";
      shadow.append(style, div);
      setPage(div);
    },
    [extraCss],
  );
  return { hostRef, page };
}

function RenderState({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <div className="p-4 text-sm text-muted">{error}</div>;
  if (loading)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> Rendering…
      </div>
    );
  return null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DocxView({ bytes }: { bytes: ArrayBuffer }) {
  const { hostRef, page } = useShadowPage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        // Styles go to the same shadow container, so the library's own page
        // chrome (white sheet on gray) applies untouched by app CSS.
        await renderAsync(bytes, page, page, { inWrapper: true });
      } catch (e) {
        if (!cancelled) setError(`Could not render this document: ${message(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      page.replaceChildren();
    };
  }, [bytes, page]);

  return (
    <div className="h-full overflow-auto">
      <RenderState error={error} loading={loading} />
      <div ref={hostRef} />
    </div>
  );
}

const SHEET_CSS = `
  .page { padding: 12px; background: #fff; }
  table { border-collapse: collapse; font-size: 12.5px; }
  td { border: 1px solid #d4d4d4; padding: 3px 8px; min-width: 42px; white-space: nowrap; }
`;

export function XlsxView({ bytes }: { bytes: ArrayBuffer }) {
  const { hostRef, page } = useShadowPage(SHEET_CSS);
  const [sheets, setSheets] = useState<SheetHtml[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Dynamic import keeps SheetJS in a lazy chunk, out of the main bundle.
        const { workbookSheets } = await import("@/lib/xlsx");
        if (cancelled) return;
        setSheets(workbookSheets(bytes));
        setActive(0);
      } catch (e) {
        if (!cancelled) setError(`Could not read this workbook: ${message(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const sheet = sheets?.[Math.min(active, sheets.length - 1)];
  useEffect(() => {
    if (page && sheet) page.innerHTML = sheet.html; // cell text is escaped by SheetJS
  }, [page, sheet]);

  if (error || !sheets) return <RenderState error={error} loading={!sheets} />;
  if (sheets.length === 0) return <div className="p-4 text-sm text-muted">This workbook has no sheets.</div>;
  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActive(i)}
              className={cn(
                "rounded px-2 py-1 text-xs",
                i === active ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div ref={hostRef} />
      </div>
      <div className="border-t border-border px-4 py-1.5 text-xs text-muted">
        {sheet?.truncated ? "Truncated preview · " : ""}Cell values only — embedded charts are not rendered.
      </div>
    </div>
  );
}

const SLIDES_CSS = `
  .page { padding: 16px; }
  .page > div > div { margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
`;

export function PptxView({ bytes }: { bytes: ArrayBuffer }) {
  const { hostRef, page } = useShadowPage(SLIDES_CSS);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    let previewer: { destroy(): void } | undefined;
    (async () => {
      try {
        const { init } = await import("pptx-preview");
        if (cancelled) return;
        // Fit slides to the pane, with a floor so a collapsed pane stays legible.
        const width = Math.max((wrapRef.current?.clientWidth ?? 0) - 32, 480);
        previewer = init(page, { width, mode: "list" });
        await (previewer as ReturnType<typeof init>).preview(bytes);
      } catch (e) {
        if (!cancelled) setError(`Could not render this presentation: ${message(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      previewer?.destroy();
      page.replaceChildren();
    };
  }, [bytes, page]);

  return (
    <div ref={wrapRef} className="h-full overflow-auto">
      <RenderState error={error} loading={loading} />
      <div ref={hostRef} />
    </div>
  );
}
