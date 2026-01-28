import { useState, useCallback } from "react";
import {
  DataProvider,
  ActionProvider,
  VisibilityProvider,
  useUIStream,
  Renderer,
} from "@json-render/react";
import { componentRegistry } from "../components/index.js";

const INITIAL_DATA = {
  analytics: {
    revenue: 125000,
    growth: 0.15,
    customers: 1234,
    orders: 567,
    salesByRegion: [
      { label: "US", value: 45000 },
      { label: "EU", value: 35000 },
      { label: "Asia", value: 28000 },
      { label: "Other", value: 17000 },
    ],
    recentTransactions: [
      {
        id: "TXN001",
        customer: "Acme Corp",
        amount: 1500,
        status: "completed",
        date: "2024-01-15",
      },
      {
        id: "TXN002",
        customer: "Globex Inc",
        amount: 2300,
        status: "pending",
        date: "2024-01-14",
      },
      {
        id: "TXN003",
        customer: "Initech",
        amount: 890,
        status: "completed",
        date: "2024-01-13",
      },
      {
        id: "TXN004",
        customer: "Umbrella Co",
        amount: 4200,
        status: "completed",
        date: "2024-01-12",
      },
    ],
  },
  form: {
    dateRange: "",
    region: "",
  },
};

const ACTION_HANDLERS = {
  export_report: () => alert("Exporting report..."),
  refresh_data: () => alert("Refreshing data..."),
  view_details: (params: Record<string, unknown>) =>
    alert(`Details: ${JSON.stringify(params)}`),
  apply_filter: () => alert("Applying filters..."),
};

function DashboardContent() {
  const [prompt, setPrompt] = useState("");
  const [showCodeExport, setShowCodeExport] = useState(false);
  const { tree, isStreaming, error, send, clear } = useUIStream({
    api: "/api/generate",
    onError: (err) => console.error("Generation error:", err),
  });

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!prompt.trim()) return;
      await send(prompt, { data: INITIAL_DATA });
    },
    [prompt, send]
  );

  const examples = [
    "Revenue dashboard with metrics and chart",
    "Recent transactions table",
    "Customer count with trend",
  ];

  const hasElements = tree && Object.keys(tree.elements).length > 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <header style={{ marginBottom: 48 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Dashboard
        </h1>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 16 }}>
          Generate widgets from prompts. Constrained to your catalog.
        </p>
      </header>

      <form onSubmit={handleSubmit} style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want..."
            disabled={isStreaming}
            style={{
              flex: 1,
              padding: "12px 16px",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--foreground)",
              fontSize: 16,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isStreaming || !prompt.trim()}
            style={{
              padding: "12px 24px",
              background: isStreaming ? "var(--border)" : "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "var(--radius)",
              fontSize: 16,
              fontWeight: 500,
              opacity: isStreaming || !prompt.trim() ? 0.5 : 1,
            }}
          >
            {isStreaming ? "Generating..." : "Generate"}
          </button>
          {hasElements && (
            <>
              <button
                type="button"
                onClick={clear}
                style={{
                  padding: "12px 16px",
                  background: "transparent",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: 16,
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              style={{
                padding: "6px 12px",
                background: "var(--card)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                fontSize: 13,
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div
          style={{
            padding: 16,
            marginBottom: 24,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "#ef4444",
            fontSize: 14,
          }}
        >
          {error.message}
        </div>
      )}

      <div
        style={{
          minHeight: 300,
          padding: 24,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        {!hasElements && !isStreaming ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "var(--muted)",
            }}
          >
            <p style={{ margin: 0 }}>Enter a prompt to generate a widget</p>
          </div>
        ) : tree ? (
          <Renderer
            tree={tree}
            registry={componentRegistry}
            loading={isStreaming}
          />
        ) : null}
      </div>

      {hasElements && (
        <details style={{ marginTop: 24 }}>
          <summary
            style={{ cursor: "pointer", fontSize: 14, color: "var(--muted)" }}
          >
            View JSON
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 16,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "auto",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            {JSON.stringify(tree, null, 2)}
          </pre>
        </details>
      )}

      {/* Code Export Modal */}
      {showCodeExport && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowCodeExport(false)}
        >
          <div
            style={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              width: "90%",
              maxWidth: 1000,
              height: "80vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowCodeExport(false)}
                  style={{
                    padding: "8px 16px",
                    background: "transparent",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                }}
              ></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <DataProvider initialData={INITIAL_DATA}>
      <VisibilityProvider>
        <ActionProvider handlers={ACTION_HANDLERS}>
          <DashboardContent />
        </ActionProvider>
      </VisibilityProvider>
    </DataProvider>
  );
}
