import type { Session, ThreadBlock } from "@ai4s/shared";
import { AgentMessage, DataTable, RunningJobsOverlay, StatusLine, UserMessage } from "./atoms";
import { ToolCallRow } from "./ToolCallRow";
import { ReviewerCard } from "./ReviewerCard";
import { StepSummaryRow } from "./StepSummaryRow";
import { FigureBlock } from "./FigureBlock";
import { Composer } from "./Composer";

function renderBlock(block: ThreadBlock, i: number) {
  switch (block.kind) {
    case "user":
      return <UserMessage key={i} block={block} />;
    case "agent":
      return <AgentMessage key={i} markdown={block.markdown} />;
    case "step-summary":
      return <StepSummaryRow key={i} block={block} />;
    case "tool-call":
      return <ToolCallRow key={i} block={block} />;
    case "reviewer":
      return <ReviewerCard key={i} block={block} />;
    case "table":
      return <DataTable key={i} block={block} />;
    case "figure":
      return <FigureBlock key={i} block={block} />;
    case "running-jobs":
      return <RunningJobsOverlay key={i} block={block} />;
    case "status-line":
      return <StatusLine key={i} block={block} />;
  }
}

export function ThreadView({ session }: { session: Session }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b border-border px-8 py-4">
        <h1 className="truncate text-lg text-text">{session.title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
          {session.blocks.map(renderBlock)}
        </div>
      </div>
      <div className="border-t border-border px-8 py-4">
        <div className="mx-auto max-w-[760px]">
          <Composer />
        </div>
      </div>
    </div>
  );
}
