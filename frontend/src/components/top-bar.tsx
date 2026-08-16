import bmoLogo from "@/assets/bmo-logo.png";

interface TopBarProps {
  onNewChat?: () => void;
}

export function TopBar({ onNewChat }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-sm z-10">
      <img src={bmoLogo} alt="BMO" className="h-7 w-auto" />
      {onNewChat && (
        <button
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
          className="text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
            />
          </svg>
        </button>
      )}
    </header>
  );
}
