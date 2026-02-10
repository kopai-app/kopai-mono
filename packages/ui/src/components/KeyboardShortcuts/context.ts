import { createContext, useContext, useEffect } from "react";
import type { ShortcutGroup } from "./types.js";

interface KeyboardShortcutsContextValue {
  register: (id: string, group: ShortcutGroup) => void;
  unregister: (id: string) => void;
}

const noop = () => {};

export const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextValue>({
    register: noop,
    unregister: noop,
  });

export function useRegisterShortcuts(id: string, group: ShortcutGroup) {
  const { register, unregister } = useContext(KeyboardShortcutsContext);
  useEffect(() => {
    register(id, group);
    return () => unregister(id);
  }, [id, group, register, unregister]);
}
