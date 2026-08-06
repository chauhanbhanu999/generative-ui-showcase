import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isDynamicToolUIPart, getToolName } from "ai";
import type { UIMessage, DynamicToolUIPart } from "ai";
import { Fragment } from "react";
import ReactMarkdown from "react-markdown";

import { FlightCard } from "@/components/flight-card";
import { PieChart } from "@/components/pie-chart";
import { NameGreeting } from "@/components/name-greeting";

export default function App() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
    }),
    onError: (error) => {
      console.error("[useChat] Error:", error);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("message") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    sendMessage({ text });
    input.value = "";
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden font-sans">
      {/* Header */}
      <header className="border-b dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 text-center shadow-sm z-10">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">GenUI Chat</h1>
      </header>

      {/* Chat Messages */}
      {/* Outer: full-width, owns the scrollbar at the far right edge */}
      <div className="chat-scroll flex-1 overflow-y-auto w-full">
        {/* Inner: centered content, never touches the scrollbar */}
        <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <svg className="w-12 h-12 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-lg">Hi! How can I help you today?</p>
          </div>
        )}

        {messages.map((message: UIMessage) => (
          <Fragment key={message.id}>
            {message.parts.map((part, partIndex) => {
              // --- Text parts ---
              if (part.type === "text") {
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
                        <p className="whitespace-pre-wrap leading-relaxed">{part.text}</p>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                          <ReactMarkdown>{part.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // --- Tool parts (Generative UI) ---
              // Handle both static (type: 'tool-*') and dynamic (type: 'dynamic-tool') tool parts
              if (isDynamicToolUIPart(part) || part.type.startsWith("tool-")) {
                const toolPart = part as DynamicToolUIPart;
                const toolName = isDynamicToolUIPart(part)
                  ? part.toolName
                  : part.type.replace("tool-", "");

                // Loading state
                if (toolPart.state !== "output-available") {
                  return (
                    <div key={`${message.id}-${partIndex}`} className="flex justify-start">
                      <div className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 rounded-2xl rounded-bl-none p-4 shadow-sm">
                        <div className="flex space-x-2 items-center text-sm text-zinc-500">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                          <span>Running {toolName}...</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Render generative UI components
                if (toolName === "pieChart") {
                  return (
                    <div key={`${message.id}-${partIndex}`} className="flex justify-start">
                      <div className="max-w-[85%]">
                        <PieChart {...(toolPart.input as any)} />
                      </div>
                    </div>
                  );
                }
                if (toolName === "flightCard") {
                  return (
                    <div key={`${message.id}-${partIndex}`} className="flex justify-center">
                      <FlightCard {...(toolPart.input as any)} />
                    </div>
                  );
                }
                if (toolName === "showMyName") {
                  return (
                    <div key={`${message.id}-${partIndex}`} className="flex justify-start">
                      <NameGreeting {...(toolPart.input as any)} />
                    </div>
                  );
                }

                // Generic tool result fallback
                const isQueryData = toolName === "query_data";
                return (
                  <div key={`${message.id}-${partIndex}`} className="flex justify-start">
                    <div className="bg-zinc-100 dark:bg-zinc-800 border dark:border-zinc-700 rounded-xl p-3 text-xs font-mono text-zinc-600 dark:text-zinc-400 max-w-[85%] overflow-auto">
                      {isQueryData ? (
                        <details>
                          <summary className="font-semibold text-zinc-800 dark:text-zinc-200 cursor-pointer select-none list-none flex items-center gap-2">
                            <span>🗄️ {toolName}</span>
                            <span className="text-zinc-400 dark:text-zinc-500 font-normal">
                              ({Array.isArray(toolPart.output) ? toolPart.output.length : "?"} rows) — click to expand
                            </span>
                          </summary>
                          <pre className="mt-2">{JSON.stringify(toolPart.output, null, 2)}</pre>
                        </details>
                      ) : (
                        <>
                          <div className="font-semibold mb-1 text-zinc-800 dark:text-zinc-200">🔧 {toolName}</div>
                          <pre>{JSON.stringify(toolPart.output, null, 2)}</pre>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              return null;
            })}
          </Fragment>
        ))}
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-zinc-950 border-t dark:border-zinc-800 shadow-[0_-4px_15px_rgba(0,0,0,0.02)] z-10">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative flex items-center">
          <input
            name="message"
            className="w-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-800 rounded-full py-4 pl-6 pr-16 outline-none transition-all duration-200 dark:text-white shadow-inner"
            placeholder="Ask Anything"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="absolute right-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 disabled:text-zinc-500 text-white rounded-full p-2.5 transition-all duration-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
