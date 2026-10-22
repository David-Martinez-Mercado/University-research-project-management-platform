import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface CardProps {
  title?: string;
  description?: string;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, description, footer, className, children }: CardProps) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || description) && (
        <header className="border-b border-slate-100 px-5 py-4 sm:px-6">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </header>
      )}
      {children && <div className="px-5 py-4 sm:px-6">{children}</div>}
      {footer && (
        <footer className="rounded-b-xl border-t border-slate-100 bg-slate-50 px-5 py-3 sm:px-6">
          {footer}
        </footer>
      )}
    </section>
  );
}
