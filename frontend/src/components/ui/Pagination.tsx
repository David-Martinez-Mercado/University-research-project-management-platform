import { Button } from './Button';

export interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  disabled?: boolean;
}

/** limit/offset pager matching the backend's pagination (response: total, limit, offset). */
export function Pagination({ total, limit, offset, onChange, disabled }: PaginationProps) {
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600" aria-live="polite">
        Mostrando {from}–{to} de {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={disabled || !hasPrev} onClick={() => onChange(Math.max(0, offset - limit))}>
          Anterior
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled || !hasNext} onClick={() => onChange(offset + limit)}>
          Siguiente
        </Button>
      </div>
    </nav>
  );
}
