import { useCallback, useRef, useState } from "react";

import type { CaseInfo } from "@/lib/case-session";

export interface FieldPrompt {
  field: string;
  prompt: string;
}

export interface UiComponentPayload {
  component: string;
  props: Record<string, any>;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  ui: UiComponentPayload | null;
  pendingFields: FieldPrompt[] | null;
  suggestions: string[];
  pendingFilingDecision?: boolean;
}

interface SendOptions {
  message?: string;
  resume?: Record<string, string>;
}

const ENDPOINT = "/api/agent";

export function useGraphChat(caseInfo: CaseInfo, initialMessages: ChatTurn[] = []) {
  const [messages, setMessages] = useState<ChatTurn[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const threadIdRef = useRef<string>(crypto.randomUUID());

  const send = useCallback(async (options: SendOptions) => {
    const isResume = options.resume !== undefined;

    setMessages((prev) => {
      const next = [...prev];
      if (isResume) {
        // Clear the fulfilled form on the most recent assistant turn.
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === "assistant" && next[idx].pendingFields) {
          next[idx] = { ...next[idx], pendingFields: null };
        }
      } else if (options.message) {
        next.push({
          id: crypto.randomUUID(),
          role: "user",
          text: options.message,
          ui: null,
          pendingFields: null,
          suggestions: [],
        });
      }
      next.push({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "",
        ui: null,
        pendingFields: null,
        suggestions: [],
      });
      return next;
    });

    setIsLoading(true);

    const updateLastAssistant = (updater: (turn: ChatTurn) => ChatTurn) => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === "assistant") {
          next[idx] = updater(next[idx]);
        }
        return next;
      });
    };

    try {
      const body = isResume
        ? { thread_id: threadIdRef.current, resume: options.resume }
        : { thread_id: threadIdRef.current, message: options.message, case_name: caseInfo.id };

      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processFrame = (frame: string) => {
        if (!frame.trim()) return;

        let eventName = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) return;

        const data = JSON.parse(dataLine);

        switch (eventName) {
          case "ui":
            updateLastAssistant((turn) => ({
              ...turn,
              ui: { component: data.component, props: data.props },
            }));
            break;
          case "message":
            updateLastAssistant((turn) => ({ ...turn, text: turn.text + data.content }));
            break;
          case "interrupt":
            updateLastAssistant((turn) => ({ ...turn, pendingFields: data.fields }));
            break;
          case "done":
            updateLastAssistant((turn) => ({ ...turn, suggestions: data.suggested_questions ?? [] }));
            break;
          case "error":
            updateLastAssistant((turn) => ({ ...turn, text: turn.text || `Error: ${data.message}` }));
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        // Some fetch implementations deliver the final chunk's bytes together
        // with done: true instead of in a preceding done: false read, so the
        // trailing "done" SSE frame must still be decoded here rather than
        // discarded by an early break.
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) processFrame(frame);
        }

        if (done) {
          // Flush a final frame even if the stream closed without a trailing
          // blank line after it.
          if (buffer.trim()) processFrame(buffer);
          break;
        }
      }
    } catch (error) {
      console.error("[useGraphChat] stream error:", error);
      updateLastAssistant((turn) => ({
        ...turn,
        text: turn.text || "Something went wrong talking to the server.",
      }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Appends a turn without a network round-trip - for client-only flows (slash
  // command echoes, validation responses) that still belong in the chat history.
  const addLocalTurn = useCallback((turn: ChatTurn) => {
    setMessages((prev) => [...prev, turn]);
  }, []);

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setMessages((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  return { messages, send, isLoading, addLocalTurn, updateTurn };
}
