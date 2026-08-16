import { useState } from "react";

import { TopBar } from "@/components/top-bar";
import { SeedScreen } from "@/components/seed-screen";
import { ChatScreen } from "@/components/chat-screen";
import type { CaseInfo } from "@/lib/case-session";

export default function App() {
  const [activeCase, setActiveCase] = useState<CaseInfo | null>(null);

  return (
    <div className="flex flex-col h-full">
      <TopBar onNewChat={activeCase ? () => setActiveCase(null) : undefined} />
      {activeCase ? (
        <ChatScreen key={activeCase.id} caseInfo={activeCase} />
      ) : (
        <SeedScreen onStart={setActiveCase} />
      )}
    </div>
  );
}
