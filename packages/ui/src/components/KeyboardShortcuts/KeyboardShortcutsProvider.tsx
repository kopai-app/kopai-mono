import { useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { ShortcutGroup, ShortcutsRegistry } from "./types.js";
import { KeyboardShortcutsContext } from "./context.js";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog.js";

const GENERAL_GROUP: ShortcutGroup = {
  name: "General",
  shortcuts: [
    { keys: ["Shift", "?"], description: "Toggle shortcuts help" },
    { keys: ["Shift", "S"], description: "Services tab" },
    { keys: ["Shift", "L"], description: "Logs tab" },
    { keys: ["Shift", "M"], description: "Metrics tab" },
  ],
};

interface KeyboardShortcutsProviderProps {
  children: ReactNode;
  onNavigateServices: () => void;
  onNavigateLogs: () => void;
  onNavigateMetrics: () => void;
}

export function KeyboardShortcutsProvider({
  children,
  onNavigateServices,
  onNavigateLogs,
  onNavigateMetrics,
}: KeyboardShortcutsProviderProps) {
  const [registry, setRegistry] = useState<ShortcutsRegistry>(() => new Map());
  const [isOpen, setIsOpen] = useState(false);

  const register = useCallback((id: string, group: ShortcutGroup) => {
    setRegistry((prev) => {
      const next = new Map(prev);
      next.set(id, group);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setRegistry((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.shiftKey && e.key === "?") {
        e.preventDefault();
        setIsOpen((v) => !v);
        return;
      }

      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      if (e.shiftKey && e.key === "S") {
        e.preventDefault();
        onNavigateServices();
        return;
      }
      if (e.shiftKey && e.key === "L") {
        e.preventDefault();
        onNavigateLogs();
        return;
      }
      if (e.shiftKey && e.key === "M") {
        e.preventDefault();
        onNavigateMetrics();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onNavigateServices, onNavigateLogs, onNavigateMetrics]);

  const groups = useMemo(() => {
    return [GENERAL_GROUP, ...registry.values()];
  }, [registry]);

  const contextValue = useMemo(
    () => ({ register, unregister }),
    [register, unregister]
  );

  return (
    <KeyboardShortcutsContext.Provider value={contextValue}>
      {children}
      <ShortcutsHelpDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        groups={groups}
      />
    </KeyboardShortcutsContext.Provider>
  );
}
