import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type DynamicToolUIPart } from "ai";
import { useState, useEffect, Fragment, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { TodoAppLayout } from "@/components/todo-app-layout";
import { TodoList } from "@/components/todo-list";

type Todo = { id: string; title: string; completed: boolean };

// Point useChat directly at the Python backend via the Vite proxy
const transport = new DefaultChatTransport({ api: "/api/agent" });

export default function App() {
  const [todosOpen, setTodosOpen] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputText, setInputText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  // ── Sync todos and panel state from agent tool call results ────────────
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts ?? []) {
        if (part.type !== "dynamic-tool") continue;
        const toolPart = part as DynamicToolUIPart;
        if (toolPart.state !== "output-available") continue;

        if (toolPart.toolName === "manage_todos") {
          const result = toolPart.output as { todos?: Todo[] } | undefined;
          if (result?.todos) setTodos(result.todos);
        }
        if (toolPart.toolName === "open_or_close_todos") {
          const result = toolPart.output as { open?: boolean } | undefined;
          if (typeof result?.open === "boolean") setTodosOpen(result.open);
        }
      }
    }
  }, [messages]);

  // ── Auto-scroll on new messages ────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ── User edits todos in the panel → push back to agent state ──────────
  const handleUpdate = async (updated: Todo[]) => {
    setTodos(updated);
    try {
      await fetch("/api/agent/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todos: updated }),
      });
    } catch {
      // best-effort; agent will re-read via get_todos on next turn
    }
  };

  // ── Handle chat form submission ────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInputText("");
  }

  // ── Chat panel UI (layout/styles from feature/controlled-genui) ────────
  const chat = (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden font-sans">
      {/* Header */}
      <header className="border-b dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 text-center shadow-sm z-10">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Todo Assistant
        </h1>
      </header>

      {/* Messages — ghost scrollbar */}
      <div className="chat-scroll flex-1 overflow-y-auto w-full">
        <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-400 pt-20">
              <svg
                className="w-12 h-12 mb-2 opacity-50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-lg">Hi! Ask me to manage your todos.</p>
              <p className="text-sm opacity-70">
                Try: "Add three todos about learning AI"
              </p>
            </div>
          )}

          {messages.map((message: UIMessage) => (
            <Fragment key={message.id}>
              {(message.parts ?? []).map((part, partIndex) => {
                if (part.type !== "text") return null;
                const isUser = message.role === "user";
                return (
                  <div
                    key={`${message.id}-${partIndex}`}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                        isUser
                          ? "bg-blue-600 text-white rounded-br-none"
                          : "bg-white dark:bg-zinc-800 border dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-bl-none"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {part.text}
                        </p>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                          <ReactMarkdown>{part.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}

          {/* Streaming indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 rounded-2xl rounded-bl-none p-4 shadow-sm">
                <div className="flex space-x-2 items-center">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                  <div
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="p-4 bg-white dark:bg-zinc-950 border-t dark:border-zinc-800 shadow-[0_-4px_15px_rgba(0,0,0,0.02)] z-10">
        <form
          onSubmit={handleSubmit}
          className="max-w-4xl mx-auto relative flex items-center"
        >
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-800 rounded-full py-4 pl-6 pr-16 outline-none transition-all duration-200 dark:text-white shadow-inner"
            placeholder="Ask about your todos..."
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="absolute right-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 disabled:text-zinc-500 text-white rounded-full p-2.5 transition-all duration-200"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <TodoAppLayout
      chat={chat}
      open={todosOpen}
      onOpenChange={setTodosOpen}
      panel={(onClose) => (
        <TodoList
          todos={todos}
          onUpdate={handleUpdate}
          isRunning={isLoading}
          onClose={onClose}
        />
      )}
    />
  );
}
