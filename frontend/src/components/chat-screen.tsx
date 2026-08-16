import ReactMarkdown from "react-markdown";

import { useGraphChat, type ChatTurn } from "@/hooks/use-graph-chat";
import { COMPONENT_REGISTRY } from "@/components/registry";
import { MissingFieldsForm } from "@/components/missing-fields-form";
import { caseLabel, type CaseInfo } from "@/lib/case-session";

interface ChatScreenProps {
  caseInfo: CaseInfo;
}

function welcomeTurn(caseInfo: CaseInfo): ChatTurn {
  return {
    id: "welcome",
    role: "assistant",
    text: `You're in the workspace for **${caseLabel(caseInfo)}**. What would you like to do?`,
    ui: null,
    pendingFields: null,
    suggestions: ["Summarize filings", "Draft email", "Check deadlines"],
  };
}

export function ChatScreen({ caseInfo }: ChatScreenProps) {
  const { messages, send, isLoading } = useGraphChat([welcomeTurn(caseInfo)]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("message") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    send({ message: text });
    input.value = "";
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden font-sans">
      {/* Chat Messages */}
      <div className="chat-scroll flex-1 overflow-y-auto w-full">
        <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
          {messages.map((turn, turnIndex) => {
            const isLast = turnIndex === messages.length - 1;

            if (turn.role === "user") {
              return (
                <div key={turn.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl p-4 shadow-sm bg-blue-600 text-white rounded-br-none">
                    <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
                  </div>
                </div>
              );
            }

            // Assistant turn: pending form takes priority, then a UI component, then chat text.
            if (turn.pendingFields) {
              return (
                <div key={turn.id} className="flex justify-start">
                  <MissingFieldsForm
                    fields={turn.pendingFields}
                    disabled={isLoading}
                    onSubmit={(values) => send({ resume: values })}
                  />
                </div>
              );
            }

            if (turn.ui) {
              const Component = COMPONENT_REGISTRY[turn.ui.component];
              return (
                <div key={turn.id} className="flex justify-start">
                  {Component ? (
                    <div className="max-w-[85%]">
                      <Component {...turn.ui.props} />
                    </div>
                  ) : (
                    <div className="max-w-[85%] rounded-xl border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
                      Unknown component: <code>{turn.ui.component}</code>
                    </div>
                  )}
                </div>
              );
            }

            if (isLast && isLoading && !turn.text) {
              return (
                <div key={turn.id} className="flex justify-start">
                  <div className="bg-white dark:bg-zinc-800 border dark:border-zinc-700 rounded-2xl rounded-bl-none p-4 shadow-sm">
                    <div className="flex space-x-2 items-center text-sm text-zinc-500">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={turn.id} className="space-y-3">
                {turn.text && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl p-4 shadow-sm bg-white dark:bg-zinc-800 border dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-bl-none">
                      <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                        <ReactMarkdown>{turn.text}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
                {isLast && !isLoading && turn.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {turn.suggestions.map((question) => (
                      <button
                        key={question}
                        onClick={() => send({ message: question })}
                        className="text-sm rounded-full border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 px-3 py-1.5 font-semibold hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-zinc-950 border-t dark:border-zinc-800 shadow-[0_-4px_15px_rgba(0,0,0,0.02)] z-10">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative flex items-center">
          <input
            name="message"
            className="w-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-800 rounded-full py-4 pl-6 pr-16 outline-none transition-all duration-200 dark:text-white shadow-inner"
            placeholder={`Message ${caseInfo.id}…`}
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
