export interface KeyboardShortcut {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: KeyboardShortcut[];
}

export type ShortcutsRegistry = Map<string, ShortcutGroup>;
