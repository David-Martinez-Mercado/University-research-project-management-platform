import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../api/notifications';
import type { AppNotification } from '../api/types';
import { NOTIFICATIONS_CHANGED, RoleShell } from '../components/RoleShell';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Pagination, Spinner } from '../components/ui';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/labels';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 10;

function changed() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => listNotifications({ unread: unreadOnly, limit: PAGE_SIZE, offset }), [unreadOnly, offset]);
  const page = list.data;

  async function read(n: AppNotification) {
    if (n.isRead) return;
    try {
      await markNotificationRead(n.id);
      list.reload();
      changed();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function readAll() {
    setError(null);
    setBusy(true);
    try {
      await markAllNotificationsRead();
      list.reload();
      changed();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Notificaciones"
          description="Avisos sobre tus proyectos: cambios de estado, asignaciones, evaluaciones y colaboradores."
          actions={
            <Button variant="secondary" loading={busy} disabled={!page || page.unread === 0} onClick={() => void readAll()}>
              Marcar todas como leídas
            </Button>
          }
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked);
              setOffset(0);
            }}
          />
          Mostrar solo no leídas
        </label>

        {error && <Alert tone="error">{error}</Alert>}

        <section aria-label="Lista de notificaciones" aria-busy={list.loading}>
          {list.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(list.error)}</Alert>
              <Button variant="secondary" onClick={list.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando notificaciones..." />
          ) : page.data.length === 0 ? (
            <EmptyState
              title={unreadOnly ? 'No tienes notificaciones sin leer' : 'Aún no tienes notificaciones'}
              description="Te avisaremos aquí cuando ocurra algo relevante en tus proyectos."
            />
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2">
                {page.data.map((n) => (
                  <li key={n.id}>
                    <Card className={n.isRead ? '' : 'border-l-4 border-l-accent-500 bg-accent-50/40'}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {n.title} {!n.isRead && <Badge tone="warning">Nueva</Badge>}
                          </p>
                          <p className="mt-0.5 break-words text-sm text-slate-700">{n.message}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(n.createdAt)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {n.projectId && (
                            <Link
                              to={`/projects/${n.projectId}`}
                              onClick={() => void read(n)}
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
                            >
                              Ver proyecto
                            </Link>
                          )}
                          {!n.isRead && (
                            <Button size="sm" variant="ghost" aria-label={`Marcar como leída: ${n.title}`} onClick={() => void read(n)}>
                              Marcar leída
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination total={page.total} limit={page.limit} offset={page.offset} disabled={list.loading} onChange={setOffset} />
            </div>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
