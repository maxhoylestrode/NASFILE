import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** A small positioned menu, opened at a click point (right-click or a "more" button). */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const menuHeight = items.length * 34 + 12;
  const menuWidth = 190;
  const top = Math.min(y, window.innerHeight - menuHeight - 8);
  const left = Math.min(x, window.innerWidth - menuWidth - 8);

  return (
    <div
      ref={ref}
      style={{ top: Math.max(top, 8), left: Math.max(left, 8) }}
      className="animate-scale-in fixed z-50 min-w-[180px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors duration-100 ${
            item.danger
              ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </button>
      ))}
    </div>
  );
}
