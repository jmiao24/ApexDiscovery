import type { Session } from "@ai4s/shared";
import { BlockList } from "./BlockList";
import { Composer } from "./Composer";

export function ThreadView({ session }: { session: Session }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b border-border px-8 py-4">
        <h1 className="truncate text-lg text-text">{session.title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
          <BlockList blocks={session.blocks} />
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
