import { useState } from "react";

export interface FilingDecisionValues {
  filingDecision: "filing" | "not_filing";
  investigatorSupport: string;
}

interface FilingDecisionFormProps {
  onSubmit: (values: FilingDecisionValues) => void;
  disabled?: boolean;
}

export function FilingDecisionForm({ onSubmit, disabled }: FilingDecisionFormProps) {
  const [filingDecision, setFilingDecision] = useState<"filing" | "not_filing" | "">("");
  const [investigatorSupport, setInvestigatorSupport] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!filingDecision) return;
    onSubmit({ filingDecision, investigatorSupport: investigatorSupport.trim() });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-sm rounded-xl border dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 shadow-sm space-y-4"
    >
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Filing decision</div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
            <input
              type="radio"
              name="filingDecision"
              value="filing"
              checked={filingDecision === "filing"}
              disabled={disabled}
              onChange={() => setFilingDecision("filing")}
            />
            Filing
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
            <input
              type="radio"
              name="filingDecision"
              value="not_filing"
              checked={filingDecision === "not_filing"}
              disabled={disabled}
              onChange={() => setFilingDecision("not_filing")}
            />
            Not filing
          </label>
        </div>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Investigator support for the decision
        </label>
        <textarea
          rows={4}
          className="w-full rounded-lg border dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:text-white resize-none"
          value={investigatorSupport}
          disabled={disabled}
          onChange={(e) => setInvestigatorSupport(e.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !filingDecision}
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 text-white text-sm font-medium py-2 transition-colors"
      >
        Generate case narrative
      </button>
    </form>
  );
}
