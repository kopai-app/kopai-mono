import { useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { ShortcutGroup, ShortcutsRegistry } from "./types.js";
import { KeyboardShortcutsContext } from "./context.js";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog.js";

const GENERAL_GROUP: ShortcutGroup = {
  name: "General",
  shortcuts: [
    { keys: ["Shift", "?"], description: "Toggle shortcuts help" },
    { keys: ["Shift", "T"], description: "Traces tab" },
    { keys: ["Shift", "L"], description: "Logs tab" },
    { keys: ["Shift", "M"], description: "Metrics tab" },
    { keys: ["Shift", "S"], description: "Service map tab" },
  ],
};

interface KeyboardShortcutsProviderProps {
  children: ReactNode;
  onNavigateServices: () => void;
  onNavigateLogs: () => void;
  onNavigateMetrics: () => void;
  /** Shift+S. Optional so existing hosts of the provider keep compiling. */
  onNavigateServiceMap?: () => void;
}

export function KeyboardShortcutsProvider({
  children,
  onNavigateServices,
  onNavigateLogs,
  onNavigateMetrics,
  onNavigateServiceMap,
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
      if (!(e.target instanceof HTMLElement)) return;
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT" ||
        e.target.isContentEditable
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

      if (e.shiftKey && e.key === "T") {
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
      if (e.shiftKey && e.key === "S" && onNavigateServiceMap) {
        e.preventDefault();
        onNavigateServiceMap();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    onNavigateServices,
    onNavigateLogs,
    onNavigateMetrics,
    onNavigateServiceMap,
  ]);

  const groups = useMemo(() => {
    const general = onNavigateServiceMap
      ? GENERAL_GROUP
      : {
          ...GENERAL_GROUP,
          shortcuts: GENERAL_GROUP.shortcuts.filter(
            (s) => !(s.keys[0] === "Shift" && s.keys[1] === "S")
          ),
        };
    return [general, ...registry.values()];
  }, [registry, onNavigateServiceMap]);

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
