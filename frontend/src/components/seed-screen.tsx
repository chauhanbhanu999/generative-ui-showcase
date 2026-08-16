import { useState } from "react";

import type { CaseInfo } from "@/lib/case-session";

interface SeedScreenProps {
  onStart: (caseInfo: CaseInfo) => void;
}

export function SeedScreen({ onStart }: SeedScreenProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onStart({ id: trimmed, name: "", status: "Open" });
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 p-10 overflow-y-auto">
      <div className="w-full max-w-[480px] rounded-[10px] border border-black/[.08] bg-white shadow-sm dark:bg-zinc-950 dark:border-white/10">
        <div className="flex flex-col items-center gap-1.5 px-8 pb-7 pt-9 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[.04em] text-blue-600">
            New session
          </div>
          <div className="mt-0.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Let's get started
          </div>
          <div className="mt-0.5 max-w-[320px] text-[13px] text-zinc-500 dark:text-zinc-400">
            Enter a case name or case id to start a conversation.
          </div>

          <form onSubmit={handleSubmit} className="mt-[18px] flex w-full gap-2">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="CASE-1042"
              className="h-11 flex-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-[18px] text-sm font-medium text-zinc-700 dark:text-zinc-200 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Start
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
