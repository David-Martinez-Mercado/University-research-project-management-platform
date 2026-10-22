import { useState } from 'react';
import { listUsers } from '../../api/users';
import { ROLES, type Role, type User } from '../../api/types';
import { UserForm } from '../../components/admin/UserForm';
import { RoleShell } from '../../components/RoleShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from '../../components/ui';
import { describeError } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/labels';
import { ROLE_LABELS } from '../../lib/roles';
import { useAsync } from '../../lib/useAsync';

const PAGE_SIZE = 10;

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const users = useAsync(
    () => listUsers({ q: search || undefined, role: role || undefined, limit: PAGE_SIZE, offset }),
    [search, role, offset],
  );
  const page = users.data;

  function saved(message: string) {
    setCreating(false);
    setEditingId(null);
    setNotice(message);
    users.reload();
  }

  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Usuarios"
          description="Crea cuentas, cambia roles y activa o desactiva el acceso. El correo debe ser único."
          actions={
            !creating && (
              <Button
                onClick={() => {
                  setCreating(true);
                  setEditingId(null);
                  setNotice(null);
                }}
              >
                Nuevo usuario
              </Button>
            )
          }
        />

        {notice && <Alert tone="success">{notice}</Alert>}

        {creating && (
          <Card title="Nuevo usuario">
            <UserForm onSaved={(u) => saved(`Usuario ${u.fullName} creado.`)} onCancel={() => setCreating(false)} />
          </Card>
        )}

        <form
          role="search"
          aria-label="Buscar usuarios"
          className="grid items-end gap-x-4 sm:grid-cols-[1fr_14rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(q.trim());
          }}
        >
          <Input label="Buscar por nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select
            label="Rol"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role | '');
              setOffset(0);
            }}
          >
            <option value="">Todos los roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <div className="pb-5">
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </div>
        </form>

        <section aria-label="Lista de usuarios" aria-busy={users.loading} className="space-y-3">
          {users.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(users.error)}</Alert>
              <Button variant="secondary" onClick={users.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando usuarios..." />
          ) : page.data.length === 0 ? (
            <EmptyState
              title="No hay usuarios con esos criterios"
              description="Prueba con otra búsqueda o quita el filtro de rol."
            />
          ) : (
            <>
              <p className="sr-only" role="status">
                {page.total} usuario{page.total === 1 ? '' : 's'}
              </p>
              <ul className="space-y-3">
                {page.data.map((u: User) => (
                  <li key={u.id}>
                    <Card>
                      {editingId === u.id ? (
                        <UserForm
                          user={u}
                          onSaved={(s) => saved(`Cambios de ${s.fullName} guardados.`)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-semibold">{u.fullName}</p>
                            <p className="break-all text-sm text-slate-600">{u.email}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {u.affiliation ?? 'Sin afiliación'} · Alta {formatDate(u.createdAt)} · Último acceso{' '}
                              {formatDateTime(u.lastLoginAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="info">{ROLE_LABELS[u.role]}</Badge>
                            {u.isOwner && <Badge tone="warning">Propietario</Badge>}
                            <Badge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Editar a ${u.fullName}`}
                              onClick={() => {
                                setEditingId(u.id);
                                setCreating(false);
                                setNotice(null);
                              }}
                            >
                              Editar
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                disabled={users.loading}
                onChange={setOffset}
              />
            </>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
