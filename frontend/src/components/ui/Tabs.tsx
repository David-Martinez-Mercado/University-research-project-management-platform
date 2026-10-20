import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Accessible name of the tablist. */
  label: string;
  /** Content of the selected tab (rendered inside the tabpanel). */
  children: ReactNode;
}

/**
 * WAI-ARIA tabs with automatic activation: Left/Right (wrapping), Home and End move focus and
 * select; only the selected tab is in the tab order (roving tabindex).
 */
export function Tabs({ tabs, selectedId, onSelect, label, children }: TabsProps) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  function move(index: number) {
    const next = tabs[(index + tabs.length) % tabs.length];
    onSelect(next.id);
    refs.current[next.id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(tabs.length - 1);
        break;
    }
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cx(
                '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600',
                selected
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selectedId)} tabIndex={0} className="pt-5 focus-visible:outline-2 focus-visible:outline-brand-600">
        {children}
      </div>
    </div>
  );
}
