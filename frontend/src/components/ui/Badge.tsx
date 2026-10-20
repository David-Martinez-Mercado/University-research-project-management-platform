import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800 ring-slate-300',
  info: 'bg-brand-50 text-brand-700 ring-brand-100',
  success: 'bg-green-50 text-green-800 ring-green-300',
  warning: 'bg-amber-50 text-amber-900 ring-amber-300',
  danger: 'bg-red-50 text-red-800 ring-red-300',
};

/**
 * Small status pill. Meaning is always carried by the visible text (never by color alone), so the
 * tone is only a reinforcement.
 */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
