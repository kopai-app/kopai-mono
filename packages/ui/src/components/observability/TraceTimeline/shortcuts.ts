import type { ShortcutGroup } from "../../KeyboardShortcuts/types.js";

export const TRACE_VIEWER_SHORTCUTS: ShortcutGroup = {
  name: "Trace Viewer",
  shortcuts: [
    { keys: ["↑/K"], description: "Previous span" },
    { keys: ["↓/J"], description: "Next span" },
    { keys: ["←"], description: "Collapse span" },
    { keys: ["→"], description: "Expand span" },
    { keys: ["Enter"], description: "Focus detail pane" },
    { keys: ["C"], description: "Copy span name" },
    { keys: ["Esc"], description: "Deselect span" },
    { keys: ["Ctrl", "Shift", "E"], description: "Expand all" },
    { keys: ["Ctrl", "Shift", "C"], description: "Collapse all" },
  ],
};
