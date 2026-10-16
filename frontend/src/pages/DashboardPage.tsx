import { useEffect, useState } from 'react';
import { getMe } from '../api/auth';
import type { User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, AppShell, Card } from '../components/ui';
import { ROLE_LABELS } from '../lib/roles';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

export function DashboardPage() {
  const { user, signOut } = useAuth();
  // Re-read from GET /auth/me so the role shown is the one the server currently holds.
  const [profile, setProfile] = useState<User | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => !cancelled && setProfile(me),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const current = profile ?? user;
  if (!current) return null;

  return (
    <AppShell user={current} onLogout={signOut}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {current.fullName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            You are signed in as {ROLE_LABELS[current.role]}.
          </p>
        </div>
        {failed && <Alert tone="error">Could not refresh your account details.</Alert>}
        <Card title="Your account" description="Details returned by the server for your session.">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Email" value={current.email} />
            <Detail label="Role" value={ROLE_LABELS[current.role]} />
            <Detail label="Affiliation" value={current.affiliation ?? 'Not set'} />
            <Detail label="Last sign-in"value={formatDate(current.lastLoginAt)} />
          </dl>
        </Card>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
