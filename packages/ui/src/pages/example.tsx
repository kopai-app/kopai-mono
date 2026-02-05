import { dashboardCatalog } from "../lib/catalog.js";
import { Renderer } from "../lib/renderer.js";
import { createRegistry } from "../lib/create-registry.js";
import { Card } from "../components/card.js";
import { Grid } from "../components/grid.js";
import { Stack } from "../components/stack.js";
import { Text } from "../components/text.js";
import { Heading } from "../components/heading.js";
import { Badge } from "../components/badge.js";
import { Divider } from "../components/divider.js";
import { Metric } from "../components/metric.js";
import { Empty } from "../components/empty.js";
import { Chart } from "../components/chart.js";
import { Table } from "../components/table.js";
import { DatePicker } from "../components/date-picker.js";
import { Button } from "../components/button.js";
import { List } from "../components/list.js";

const registry = createRegistry(dashboardCatalog, {
  Card,
  Grid,
  Stack,
  Text,
  Heading,
  Badge,
  Divider,
  Metric,
  Empty,
  Chart,
  Table,
  DatePicker,
  Button,
  List,
});

// UITree showcasing all components
const exampleTree = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: [
        "heading",
        "typography-card",
        "status-card",
        "layout-card",
        "data-card",
        "interactive-card",
        "empty-card",
      ],
      parentKey: "",
      props: { direction: "vertical", gap: "lg", align: null },
    },
    heading: {
      key: "heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "Component Catalog", level: "h1" },
    },

    // Typography Card
    "typography-card": {
      key: "typography-card",
      type: "Card" as const,
      children: ["typography-content"],
      parentKey: "root",
      props: {
        title: "Typography",
        description: "Text and heading components",
        padding: "md",
      },
    },
    "typography-content": {
      key: "typography-content",
      type: "Stack" as const,
      children: [
        "h1",
        "h2",
        "h3",
        "h4",
        "text-default",
        "text-muted",
        "text-success",
      ],
      parentKey: "typography-card",
      props: { direction: "vertical", gap: "sm", align: null },
    },
    h1: {
      key: "h1",
      type: "Heading" as const,
      children: [],
      parentKey: "typography-content",
      props: { text: "Heading Level 1", level: "h1" },
    },
    h2: {
      key: "h2",
      type: "Heading" as const,
      children: [],
      parentKey: "typography-content",
      props: { text: "Heading Level 2", level: "h2" },
    },
    h3: {
      key: "h3",
      type: "Heading" as const,
      children: [],
      parentKey: "typography-content",
      props: { text: "Heading Level 3", level: "h3" },
    },
    h4: {
      key: "h4",
      type: "Heading" as const,
      children: [],
      parentKey: "typography-content",
      props: { text: "Heading Level 4", level: "h4" },
    },
    "text-default": {
      key: "text-default",
      type: "Text" as const,
      children: [],
      parentKey: "typography-content",
      props: {
        content: "Default text content",
        variant: null,
        color: "default",
      },
    },
    "text-muted": {
      key: "text-muted",
      type: "Text" as const,
      children: [],
      parentKey: "typography-content",
      props: { content: "Muted text content", variant: null, color: "muted" },
    },
    "text-success": {
      key: "text-success",
      type: "Text" as const,
      children: [],
      parentKey: "typography-content",
      props: {
        content: "Success text content",
        variant: null,
        color: "success",
      },
    },

    // Status Card
    "status-card": {
      key: "status-card",
      type: "Card" as const,
      children: ["status-content"],
      parentKey: "root",
      props: {
        title: "Status Components",
        description: "Badges and dividers",
        padding: "md",
      },
    },
    "status-content": {
      key: "status-content",
      type: "Stack" as const,
      children: ["badges-row", "divider1", "divider-labeled"],
      parentKey: "status-card",
      props: { direction: "vertical", gap: "md", align: null },
    },
    "badges-row": {
      key: "badges-row",
      type: "Stack" as const,
      children: [
        "badge-default",
        "badge-success",
        "badge-warning",
        "badge-danger",
        "badge-info",
      ],
      parentKey: "status-content",
      props: { direction: "horizontal", gap: "sm", align: "center" },
    },
    "badge-default": {
      key: "badge-default",
      type: "Badge" as const,
      children: [],
      parentKey: "badges-row",
      props: { text: "Default", variant: "default" },
    },
    "badge-success": {
      key: "badge-success",
      type: "Badge" as const,
      children: [],
      parentKey: "badges-row",
      props: { text: "Success", variant: "success" },
    },
    "badge-warning": {
      key: "badge-warning",
      type: "Badge" as const,
      children: [],
      parentKey: "badges-row",
      props: { text: "Warning", variant: "warning" },
    },
    "badge-danger": {
      key: "badge-danger",
      type: "Badge" as const,
      children: [],
      parentKey: "badges-row",
      props: { text: "Danger", variant: "danger" },
    },
    "badge-info": {
      key: "badge-info",
      type: "Badge" as const,
      children: [],
      parentKey: "badges-row",
      props: { text: "Info", variant: "info" },
    },
    divider1: {
      key: "divider1",
      type: "Divider" as const,
      children: [],
      parentKey: "status-content",
      props: { label: null },
    },
    "divider-labeled": {
      key: "divider-labeled",
      type: "Divider" as const,
      children: [],
      parentKey: "status-content",
      props: { label: "Labeled Divider" },
    },

    // Layout Card
    "layout-card": {
      key: "layout-card",
      type: "Card" as const,
      children: ["layout-content"],
      parentKey: "root",
      props: {
        title: "Layout Components",
        description: "Grid and stack layouts",
        padding: "md",
      },
    },
    "layout-content": {
      key: "layout-content",
      type: "Stack" as const,
      children: ["grid-example", "list-example"],
      parentKey: "layout-card",
      props: { direction: "vertical", gap: "md", align: null },
    },
    "grid-example": {
      key: "grid-example",
      type: "Grid" as const,
      children: ["grid-item-1", "grid-item-2", "grid-item-3", "grid-item-4"],
      parentKey: "layout-content",
      props: { columns: 2, gap: "md" },
    },
    "grid-item-1": {
      key: "grid-item-1",
      type: "Card" as const,
      children: ["grid-item-1-text"],
      parentKey: "grid-example",
      props: { title: "Grid Item 1", description: null, padding: "sm" },
    },
    "grid-item-1-text": {
      key: "grid-item-1-text",
      type: "Text" as const,
      children: [],
      parentKey: "grid-item-1",
      props: { content: "Content in grid", variant: null, color: null },
    },
    "grid-item-2": {
      key: "grid-item-2",
      type: "Card" as const,
      children: ["grid-item-2-text"],
      parentKey: "grid-example",
      props: { title: "Grid Item 2", description: null, padding: "sm" },
    },
    "grid-item-2-text": {
      key: "grid-item-2-text",
      type: "Text" as const,
      children: [],
      parentKey: "grid-item-2",
      props: { content: "Content in grid", variant: null, color: null },
    },
    "grid-item-3": {
      key: "grid-item-3",
      type: "Card" as const,
      children: ["grid-item-3-text"],
      parentKey: "grid-example",
      props: { title: "Grid Item 3", description: null, padding: "sm" },
    },
    "grid-item-3-text": {
      key: "grid-item-3-text",
      type: "Text" as const,
      children: [],
      parentKey: "grid-item-3",
      props: { content: "Content in grid", variant: null, color: null },
    },
    "grid-item-4": {
      key: "grid-item-4",
      type: "Card" as const,
      children: ["grid-item-4-text"],
      parentKey: "grid-example",
      props: { title: "Grid Item 4", description: null, padding: "sm" },
    },
    "grid-item-4-text": {
      key: "grid-item-4-text",
      type: "Text" as const,
      children: [],
      parentKey: "grid-item-4",
      props: { content: "Content in grid", variant: null, color: null },
    },
    "list-example": {
      key: "list-example",
      type: "List" as const,
      children: ["list-item-1", "list-item-2"],
      parentKey: "layout-content",
      props: { dataPath: "items", emptyMessage: "No items found" },
    },
    "list-item-1": {
      key: "list-item-1",
      type: "Text" as const,
      children: [],
      parentKey: "list-example",
      props: { content: "List item 1", variant: null, color: null },
    },
    "list-item-2": {
      key: "list-item-2",
      type: "Text" as const,
      children: [],
      parentKey: "list-example",
      props: { content: "List item 2", variant: null, color: null },
    },

    // Data Display Card
    "data-card": {
      key: "data-card",
      type: "Card" as const,
      children: ["data-content"],
      parentKey: "root",
      props: {
        title: "Data Display",
        description: "Metrics, charts, and tables",
        padding: "md",
      },
    },
    "data-content": {
      key: "data-content",
      type: "Stack" as const,
      children: ["metrics-grid", "chart-example", "table-example"],
      parentKey: "data-card",
      props: { direction: "vertical", gap: "lg", align: null },
    },
    "metrics-grid": {
      key: "metrics-grid",
      type: "Grid" as const,
      children: ["metric-1", "metric-2", "metric-3"],
      parentKey: "data-content",
      props: { columns: 3, gap: "md" },
    },
    "metric-1": {
      key: "metric-1",
      type: "Metric" as const,
      children: [],
      parentKey: "metrics-grid",
      props: {
        label: "Total Users",
        valuePath: "1,234",
        format: "number",
        trend: "up",
        trendValue: "12%",
      },
    },
    "metric-2": {
      key: "metric-2",
      type: "Metric" as const,
      children: [],
      parentKey: "metrics-grid",
      props: {
        label: "Revenue",
        valuePath: "$45,678",
        format: "currency",
        trend: "up",
        trendValue: "8%",
      },
    },
    "metric-3": {
      key: "metric-3",
      type: "Metric" as const,
      children: [],
      parentKey: "metrics-grid",
      props: {
        label: "Bounce Rate",
        valuePath: "23%",
        format: "percent",
        trend: "down",
        trendValue: "5%",
      },
    },
    "chart-example": {
      key: "chart-example",
      type: "Chart" as const,
      children: [],
      parentKey: "data-content",
      props: {
        type: "bar",
        dataPath: "analytics.weekly",
        title: "Weekly Activity",
        height: 150,
      },
    },
    "table-example": {
      key: "table-example",
      type: "Table" as const,
      children: [],
      parentKey: "data-content",
      props: {
        dataPath: "users",
        columns: [
          { key: "name", label: "Name", format: "text" },
          { key: "status", label: "Status", format: "badge" },
          { key: "amount", label: "Amount", format: "currency" },
        ],
      },
    },

    // Interactive Card
    "interactive-card": {
      key: "interactive-card",
      type: "Card" as const,
      children: ["interactive-content"],
      parentKey: "root",
      props: {
        title: "Interactive Components",
        description: "Buttons and date pickers",
        padding: "md",
      },
    },
    "interactive-content": {
      key: "interactive-content",
      type: "Stack" as const,
      children: ["buttons-row", "datepicker-example"],
      parentKey: "interactive-card",
      props: { direction: "vertical", gap: "md", align: null },
    },
    "buttons-row": {
      key: "buttons-row",
      type: "Stack" as const,
      children: [
        "btn-primary",
        "btn-secondary",
        "btn-danger",
        "btn-ghost",
        "btn-disabled",
      ],
      parentKey: "interactive-content",
      props: { direction: "horizontal", gap: "sm", align: "center" },
    },
    "btn-primary": {
      key: "btn-primary",
      type: "Button" as const,
      children: [],
      parentKey: "buttons-row",
      props: {
        label: "Primary",
        variant: "primary",
        size: "md",
        action: "primaryAction",
        disabled: null,
      },
    },
    "btn-secondary": {
      key: "btn-secondary",
      type: "Button" as const,
      children: [],
      parentKey: "buttons-row",
      props: {
        label: "Secondary",
        variant: "secondary",
        size: "md",
        action: "secondaryAction",
        disabled: null,
      },
    },
    "btn-danger": {
      key: "btn-danger",
      type: "Button" as const,
      children: [],
      parentKey: "buttons-row",
      props: {
        label: "Danger",
        variant: "danger",
        size: "md",
        action: "dangerAction",
        disabled: null,
      },
    },
    "btn-ghost": {
      key: "btn-ghost",
      type: "Button" as const,
      children: [],
      parentKey: "buttons-row",
      props: {
        label: "Ghost",
        variant: "ghost",
        size: "md",
        action: "ghostAction",
        disabled: null,
      },
    },
    "btn-disabled": {
      key: "btn-disabled",
      type: "Button" as const,
      children: [],
      parentKey: "buttons-row",
      props: {
        label: "Disabled",
        variant: "primary",
        size: "md",
        action: "disabledAction",
        disabled: true,
      },
    },
    "datepicker-example": {
      key: "datepicker-example",
      type: "DatePicker" as const,
      children: [],
      parentKey: "interactive-content",
      props: {
        label: "Select Date",
        bindPath: "filters.date",
        placeholder: "Choose a date",
      },
    },

    // Empty State Card
    "empty-card": {
      key: "empty-card",
      type: "Card" as const,
      children: ["empty-example"],
      parentKey: "root",
      props: {
        title: "Empty State",
        description: "Placeholder for empty content",
        padding: "md",
      },
    },
    "empty-example": {
      key: "empty-example",
      type: "Empty" as const,
      children: [],
      parentKey: "empty-card",
      props: {
        title: "No Data Available",
        description: "Try adjusting your filters or adding new data.",
        action: "addData",
        actionLabel: "Add Data",
      },
    },
  },
};

export default function ExamplePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 24,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <Renderer tree={exampleTree} registry={registry} />
    </div>
  );
}
