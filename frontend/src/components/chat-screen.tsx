import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { useGraphChat, type ChatTurn } from "@/hooks/use-graph-chat";
import { COMPONENT_REGISTRY } from "@/components/registry";
import { MissingFieldsForm } from "@/components/missing-fields-form";
import { CommandMenu, type CommandMenuOption } from "@/components/command-menu";
import { FilingDecisionForm, type FilingDecisionValues } from "@/components/filing-decision-form";
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

const ROOT_COMMANDS: { cmd: "ask" | "generate"; label: string; description: string }[] = [
  { cmd: "ask", label: "/ask", description: "Ask one of the predefined case questions" },
  { cmd: "generate", label: "/generate", description: "Generate a case report" },
];

const ASK_QUESTIONS = [
  "Show Top Incoming Type",
  "Show Top Outgoing Type",
  "Show Top Incoming Counterparties",
  "Show Top Outgoing Counterparties",
  "What is the primary source of funding for the customer's account?",
  "How are the incoming funds primarily depleted?",
  "Is there evidence of regular personal banking?",
  "Who are the top counterparties that the client is transacting with?",
  "How many instances of structuring deposits have occurred within the review period?",
  "Are there any keywords in the EMT/wire/cheque/wire memos indicative of a possible predicate offense?",
  "Is there evidence of business-related activity?",
  "Create summary",
];

const GENERATE_OPTIONS: CommandMenuOption[] = [
  { value: "full", label: "Full case report" },
  { value: "selective", label: "Selective case report" },
  { value: "narrative", label: "Case narrative" },
];

type SlashState =
  | { mode: "none"; query: "" }
  | { mode: "root"; query: string }
  | { mode: "ask"; query: string }
  | { mode: "generate"; query: string };

function getSlashState(value: string): SlashState {
  if (!value.startsWith("/")) return { mode: "none", query: "" };
  for (const c of ROOT_COMMANDS) {
    const prefix = `/${c.cmd}`;
    if (value === prefix || value.startsWith(`${prefix} `)) {
      return { mode: c.cmd, query: value.slice(prefix.length).trim().toLowerCase() };
    }
  }
  return { mode: "root", query: value.slice(1).toLowerCase() };
}

function getMenuOptions(slash: SlashState): CommandMenuOption[] {
  if (slash.mode === "root") {
    return ROOT_COMMANDS.filter((c) => c.cmd.startsWith(slash.query)).map((c) => ({
      value: c.cmd,
      label: c.label,
      description: c.description,
    }));
  }
  if (slash.mode === "ask") {
    return ASK_QUESTIONS.filter((q) => q.toLowerCase().includes(slash.query)).map((q) => ({
      value: q,
      label: q,
    }));
  }
  if (slash.mode === "generate") {
    return GENERATE_OPTIONS.filter((o) => o.label.toLowerCase().includes(slash.query));
  }
  return [];
}

// A case narrative needs a summary already sitting in the conversation: any user
// turn mentioning "summary" that got a non-empty assistant reply counts as one.
function hasCaseSummary(messages: ChatTurn[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    const turn = messages[i];
    if (turn.role === "user" && /summary/i.test(turn.text)) {
      const next = messages[i + 1];
      if (next && next.role === "assistant" && (next.text.trim().length > 0 || next.ui)) {
        return true;
      }
    }
  }
  return false;
}

export function ChatScreen({ caseInfo }: ChatScreenProps) {
  const { messages, send, isLoading, addLocalTurn, updateTurn } = useGraphChat([welcomeTurn(caseInfo)]);
  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const slashState = getSlashState(inputValue);
  const menuOptions = getMenuOptions(slashState);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [slashState.mode, slashState.query]);

  // Keep the chat pinned to the newest content: new turns, streamed text chunks,
  // and UI components all update `messages`, so this fires on every one of them.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleGenerateNarrative() {
    addLocalTurn({
      id: crypto.randomUUID(),
      role: "user",
      text: "Generate case narrative",
      ui: null,
      pendingFields: null,
      suggestions: [],
    });

    if (hasCaseSummary(messages)) {
      addLocalTurn({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Before I can generate the case narrative, I need the filing decision and investigator support for it.",
        ui: null,
        pendingFields: null,
        suggestions: [],
        pendingFilingDecision: true,
      });
    } else {
      addLocalTurn({
        id: crypto.randomUUID(),
        role: "assistant",
        text: 'Case narrative cannot be generated without a summary and filing decision. Try **/ask** → "Create summary" first, then run **/generate** → "Case narrative" again.',
        ui: null,
        pendingFields: null,
        suggestions: [],
      });
    }
  }

  function handleSlashSelect(mode: "root" | "ask" | "generate", value: string) {
    if (mode === "root") {
      setInputValue(`/${value} `);
      return;
    }
    setInputValue("");
    if (mode === "ask") {
      send({ message: value });
      return;
    }
    if (value === "narrative") {
      handleGenerateNarrative();
      return;
    }
    const label = GENERATE_OPTIONS.find((o) => o.value === value)?.label ?? "report";
    send({ message: `Download the ${label.toLowerCase()}` });
  }

  function handleFilingSubmit(turnId: string, values: FilingDecisionValues) {
    updateTurn(turnId, { pendingFilingDecision: false });
    const decisionLabel = values.filingDecision === "filing" ? "Filing" : "Not filing";
    const support = values.investigatorSupport || "N/A";
    send({
      message: `Download the case narrative report. Filing decision: ${decisionLabel}. Investigator support: ${support}.`,
    });
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (slashState.mode === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, Math.max(menuOptions.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const opt = menuOptions[highlightedIndex];
      if (opt) {
        e.preventDefault();
        handleSlashSelect(slashState.mode as "root" | "ask" | "generate", opt.value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputValue("");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (slashState.mode !== "none") return;
    const text = inputValue.trim();
    if (!text) return;
    send({ message: text });
    setInputValue("");
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden font-sans">
      {/* Chat Messages */}
      <div ref={scrollContainerRef} className="chat-scroll flex-1 overflow-y-auto w-full">
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

            if (turn.pendingFilingDecision) {
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
                  <div className="flex justify-start">
                    <FilingDecisionForm
                      disabled={isLoading}
                      onSubmit={(values) => handleFilingSubmit(turn.id, values)}
                    />
                  </div>
                </div>
              );
            }

            if (turn.ui) {
              const Component = COMPONENT_REGISTRY[turn.ui.component];
              if (Component && turn.ui.component === "download-button") {
                return (
                  <div key={turn.id} className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl p-4 shadow-sm bg-white dark:bg-zinc-800 border dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-bl-none">
                      <Component {...turn.ui.props} />
                    </div>
                  </div>
                );
              }
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
          {slashState.mode !== "none" && (
            <CommandMenu
              title={slashState.mode === "root" ? "Commands" : slashState.mode === "ask" ? "Ask" : "Generate"}
              options={menuOptions}
              highlightedIndex={highlightedIndex}
              onHighlight={setHighlightedIndex}
              onSelect={(value) => handleSlashSelect(slashState.mode as "root" | "ask" | "generate", value)}
              onClose={() => setInputValue("")}
            />
          )}
          <input
            name="message"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            className="w-full bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-800 rounded-full py-4 pl-6 pr-16 outline-none transition-all duration-200 dark:text-white shadow-inner"
            placeholder="Type a message, or / for commands"
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
