import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./error-boundary";
import "./globals.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <main className="h-screen w-screen">
        <App />
      </main>
    </ErrorBoundary>
  </StrictMode>,
);
