import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/simple-component-catalog.js";

export function Table({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Table>) {
  const { dataPath, columns } = element.props;

  // Static mock data for example page
  const mockData = [
    { id: 1, name: "Item A", status: "Active", amount: 1250 },
    { id: 2, name: "Item B", status: "Pending", amount: 830 },
    { id: 3, name: "Item C", status: "Completed", amount: 2100 },
  ];

  const formatCell = (
    value: unknown,
    format?: "text" | "currency" | "date" | "badge" | null
  ) => {
    if (value === null || value === undefined) return "-";
    if (format === "currency" && typeof value === "number") {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
    }
    if (format === "date" && typeof value === "string") {
      return new Date(value).toLocaleDateString();
    }
    if (format === "badge") {
      return (
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 500,
            background: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          {String(value)}
        </span>
      );
    }
    return String(value);
  };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  textAlign: "left",
                  padding: "12px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mockData.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: "12px 8px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 14,
                  }}
                >
                  {formatCell(row[col.key as keyof typeof row], col.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
        Data: {dataPath}
      </p>
    </div>
  );
}
