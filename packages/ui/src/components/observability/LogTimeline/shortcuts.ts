import type { ShortcutGroup } from "../../KeyboardShortcuts/types.js";

export const LOG_VIEWER_SHORTCUTS: ShortcutGroup = {
  name: "Log Viewer",
  shortcuts: [
    { keys: ["↑/K"], description: "Previous log" },
    { keys: ["↓/J"], description: "Next log" },
    { keys: ["G"], description: "Scroll to bottom" },
    { keys: ["Home"], description: "First log" },
    { keys: ["/"], description: "Focus search" },
    { keys: ["F"], description: "Toggle filters" },
    { keys: ["Enter"], description: "Open log detail" },
    { keys: ["C"], description: "Copy log body" },
    { keys: ["W"], description: "Toggle word wrap" },
    { keys: ["T"], description: "Toggle timestamps" },
    { keys: ["Esc"], description: "Close detail/filter pane" },
  ],
};
