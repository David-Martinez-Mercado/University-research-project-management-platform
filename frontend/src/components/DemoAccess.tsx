import { DEMO_ACCOUNTS, type DemoAccount } from '../lib/demoAccounts';

/** One-click sign-in for each demo role (development only; see lib/demoAccounts.ts). */
export function DemoAccess({ onPick, disabled }: { onPick: (account: DemoAccount) => void; disabled: boolean }) {
  return (
    <section aria-label="Acceso rápido de demostración" className="mt-8 rounded-2xl border border-dashed border-accent-500/60 bg-accent-50/50 p-4">
      <h2 className="text-sm font-semibold text-accent-700">Acceso rápido (demostración)</h2>
      <p className="mt-0.5 text-xs text-slate-600">Entra con una cuenta de prueba, sin escribir nada.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(account)}
              className="w-full rounded-lg bg-white px-3 py-2 text-left shadow-sm ring-1 ring-inset ring-slate-300 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-medium text-slate-900">Entrar como {account.label}</span>
              <span className="block text-xs text-slate-500">{account.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
