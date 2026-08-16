import { useState } from "react";
import type { FieldPrompt } from "@/hooks/use-graph-chat";

interface MissingFieldsFormProps {
  fields: FieldPrompt[];
  onSubmit: (values: Record<string, string>) => void;
  disabled?: boolean;
}

export function MissingFieldsForm({ fields, onSubmit, disabled }: MissingFieldsFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nonEmpty = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim().length > 0),
    );
    onSubmit(nonEmpty);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-sm rounded-xl border dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 shadow-sm space-y-3"
    >
      {fields.map(({ field, prompt }) => (
        <div key={field} className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {prompt}
          </label>
          <input
            className="w-full rounded-lg border dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:text-white"
            value={values[field] ?? ""}
            disabled={disabled}
            onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
          />
        </div>
      ))}
      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 text-white text-sm font-medium py-2 transition-colors"
      >
        Send
      </button>
    </form>
  );
}
