import * as Popover from "@radix-ui/react-popover";
import { Download } from "lucide-react";
import type { FigureBlock as FigureBlockT } from "@ai4s/shared";

export function FigureBlock({ block }: { block: FigureBlockT }) {
  return (
    <figure className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-text">{block.title}</span>
        <button className="ml-auto text-muted hover:text-text" aria-label="Download figure">
          <Download size={15} />
        </button>
      </div>
      <div className="relative bg-white p-4">
        {block.caption && (
          <div className="mb-2 text-center text-xs text-muted">{block.caption}</div>
        )}
        <img src={block.src} alt={block.title} className="mx-auto block max-w-full" />
        {block.annotation && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg shadow-pop ring-2 ring-white"
                style={{ left: `${block.annotation.x}%`, top: `${block.annotation.y}%` }}
                aria-label={`Annotation ${block.annotation.index}`}
              >
                {block.annotation.index}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={8}
                className="z-50 flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-pop"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                  {block.annotation.index}
                </span>
                <span className="text-text">{block.annotation.note}</span>
                <button className="rounded-input bg-text px-3 py-1 text-xs font-medium text-bg">
                  Send
                </button>
                <Popover.Arrow className="fill-[var(--surface)]" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>
    </figure>
  );
}
