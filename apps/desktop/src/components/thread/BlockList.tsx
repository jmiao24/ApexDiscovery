import type { ThreadBlock } from "@ai4s/shared";
import { AgentMessage, DataTable, RunningJobsOverlay, StatusLine, UserMessage } from "./atoms";
import { ToolCallRow } from "./ToolCallRow";
import { ReviewerCard } from "./ReviewerCard";
import { StepSummaryRow } from "./StepSummaryRow";
import { FigureBlock } from "./FigureBlock";

export function renderBlock(block: ThreadBlock, i: number) {
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

export function BlockList({ blocks }: { blocks: ThreadBlock[] }) {
  return <>{blocks.map(renderBlock)}</>;
}
