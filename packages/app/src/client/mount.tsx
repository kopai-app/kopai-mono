import React from "react";
import ReactDOM from "react-dom/client";
import "@kopai/ui/globals.css";
import { ObservabilityPage } from "@kopai/ui";

document.documentElement.classList.add("dark");
document.body.classList.add("bg-background");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Observability</h1>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "?", shiftKey: true })
            )
          }
        >
          Press{" "}
          <kbd className="px-1 py-0.5 text-xs border border-zinc-700 rounded bg-zinc-800">
            ?
          </kbd>{" "}
          for shortcuts
        </button>
      </div>
      <ObservabilityPage />
    </div>
  </React.StrictMode>
);
