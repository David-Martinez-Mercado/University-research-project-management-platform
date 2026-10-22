import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createInvestorLink, deleteInvestorLink, listInvestorLinks } from '../../api/investors';
import { listProjects } from '../../api/projects';
import { listUsers } from '../../api/users';
import { StatusBadge } from '../../components/badges';
import { RoleShell } from '../../components/RoleShell';
import { Alert, Button, Card, EmptyState, PageHeader, Pagination, Select, Spinner } from '../../components/ui';
import { describeError } from '../../lib/errors';
import { formatDate } from '../../lib/labels';
import { useAsync } from '../../lib/useAsync';

const PAGE_SIZE = 10;

export function AdminInvestorsPage() {
  const [offset, setOffset] = useState(0);
  const links = useAsync(() => listInvestorLinks({ limit: PAGE_SIZE, offset }), [offset]);
  const investors = useAsync(() => listUsers({ role: 'INVESTOR', limit: 100 }).then((p) => p.data.filter((u) => u.isActive)), []);
  const projects = useAsync(() => listProjects({ limit: 100 }).then((p) => p.data), []);

  const [investorId, setInvestorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!investorId || !projectId) {
      setFormError('Elige un inversionista y un proyecto.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const created = await createInvestorLink(investorId, projectId);
      setNotice(`${created.investor.fullName} ahora ve «${created.project.title}».`);
      setProjectId('');
      setOffset(0);
      links.reload();
    } catch (err) {
      setFormError(describeError(err, 'investor-link'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, label: string) {
    setRemoveError(null);
    setNotice(null);
    setRemovingId(id);
    try {
      await deleteInvestorLink(id);
      setNotice(`Se quitó el vínculo: ${label}.`);
      links.reload();
    } catch (err) {
      setRemoveError(describeError(err, 'investor-link'));
    } finally {
      setRemovingId(null);
    }
  }

  const page = links.data;
  return (
    <RoleShell>
      <div className="space-y-6">
        <PageHeader
          title="Vínculos de inversionistas"
          description="Un inversionista solo ve los proyectos que vinculas aquí, y únicamente en modo lectura."
        />

        {notice && <Alert tone="success">{notice}</Alert>}

        <Card title="Nuevo vínculo">
          <form onSubmit={submit} noValidate className="space-y-3" aria-label="Nuevo vínculo">
            {formError && <Alert tone="error">{formError}</Alert>}
            {!!(investors.error || projects.error) && <Alert tone="error">{describeError(investors.error ?? projects.error)}</Alert>}
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Select
                label="Inversionista"
                value={investorId}
                onChange={(e) => setInvestorId(e.target.value)}
                disabled={saving || !investors.data}
                hint={investors.data && investors.data.length === 0 ? 'No hay inversionistas activos. Crea uno en Usuarios.' : undefined}
              >
                <option value="">Selecciona un inversionista</option>
                {investors.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
              <Select label="Proyecto" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={saving || !projects.data}>
                <option value="">Selecciona un proyecto</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={saving}>
              Vincular
            </Button>
          </form>
        </Card>

        <section aria-label="Vínculos" aria-busy={links.loading} className="space-y-3">
          <h2 className="text-lg font-semibold">Vínculos actuales</h2>
          {removeError && <Alert tone="error">{removeError}</Alert>}
          {links.error ? (
            <div className="space-y-3">
              <Alert tone="error">{describeError(links.error)}</Alert>
              <Button variant="secondary" onClick={links.reload}>
                Reintentar
              </Button>
            </div>
          ) : !page ? (
            <Spinner label="Cargando vínculos..." />
          ) : page.data.length === 0 ? (
            <EmptyState title="Aún no hay vínculos" description="Vincula un inversionista a un proyecto para que pueda seguir su avance." />
          ) : (
            <>
              <ul className="space-y-3">
                {page.data.map((l) => (
                  <li key={l.id}>
                    <Card>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold">
                            <Link to={`/projects/${l.project.id}`} className="text-brand-700 hover:underline">
                              {l.project.title}
                            </Link>
                          </p>
                          <p className="text-sm text-slate-600">
                            {l.investor.fullName} ({l.investor.email}) · vinculado {formatDate(l.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={l.project.status} />
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={removingId === l.id}
                            aria-label={`Quitar a ${l.investor.fullName} de ${l.project.title}`}
                            onClick={() => void remove(l.id, `${l.investor.fullName} / ${l.project.title}`)}
                          >
                            Quitar
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination total={page.total} limit={page.limit} offset={page.offset} disabled={links.loading} onChange={setOffset} />
            </>
          )}
        </section>
      </div>
    </RoleShell>
  );
}
