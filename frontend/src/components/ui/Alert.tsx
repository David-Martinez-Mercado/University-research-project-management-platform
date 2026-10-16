import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Tone = 'error' | 'info' | 'success';

const TONES: Record<Tone, string> = {
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-brand-100 bg-brand-50 text-brand-700',
  success: 'border-green-200 bg-green-50 text-green-900',
};

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-md border px-3 py-2.5 text-sm', TONES[tone])}
    >
      {children}
    </div>
  );
}
