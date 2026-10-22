import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Optional call to action (a Button or link). */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-brand-200 bg-white px-6 py-10 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
