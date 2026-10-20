/** Loading indicator that announces itself to assistive technology. */
export function Spinner({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-8 text-sm text-slate-600">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"
      />
      <span>{label}</span>
    </div>
  );
}
