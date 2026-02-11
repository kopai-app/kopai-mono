import type { ShortcutGroup } from "./types.js";

interface ShortcutsHelpDialogProps {
  open: boolean;
  onClose: () => void;
  groups: ShortcutGroup[];
}

export function ShortcutsHelpDialog({
  open,
  onClose,
  groups,
}: ShortcutsHelpDialogProps) {
  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-400 hover:text-zinc-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {groups.map((group) => (
            <div key={group.name}>
              <h3 className="text-sm font-medium text-zinc-400 mb-3">
                {group.name}
              </h3>
              <ul className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.description}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-zinc-300">
                      {shortcut.description}
                    </span>
                    <span className="flex gap-1 ml-4">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={key}
                          className="px-1.5 py-0.5 text-xs font-mono bg-zinc-800 border border-zinc-600 rounded text-zinc-300"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
