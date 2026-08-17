export interface CommandMenuOption {
  value: string;
  label: string;
  description?: string;
}

interface CommandMenuProps {
  title: string;
  options: CommandMenuOption[];
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function CommandMenu({
  title,
  options,
  highlightedIndex,
  onHighlight,
  onSelect,
  onClose,
}: CommandMenuProps) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-xl border dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-20">
      <div className="flex items-center justify-between px-3 py-2 border-b dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          Esc
        </button>
      </div>
      <ul className="py-1">
        {options.map((opt, index) => (
          <li key={opt.value}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(opt.value)}
              onMouseEnter={() => onHighlight(index)}
              className={`w-full text-left px-3 py-2 text-sm flex flex-col ${
                index === highlightedIndex
                  ? "bg-blue-50 dark:bg-blue-950"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{opt.label}</span>
              {opt.description && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{opt.description}</span>
              )}
            </button>
          </li>
        ))}
        {options.length === 0 && (
          <li className="px-3 py-2 text-sm text-zinc-400">No matches</li>
        )}
      </ul>
    </div>
  );
}
