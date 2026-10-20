import { useState, type FormEvent } from 'react';
import { addCollaborator, removeCollaborator } from '../../api/projects';
import type { Collaborator, CollaboratorRole } from '../../api/types';
import { describeError, fieldErrorsFrom } from '../../lib/errors';
import { COLLABORATOR_ROLE_LABELS, formatDate } from '../../lib/labels';
import { ROLE_LABELS } from '../../lib/roles';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

// Light client-side check; the server is the authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CollaboratorsTab({ project, canManage, userId, collaborators }: WorkspaceContext) {
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<CollaboratorRole>('MEMBER');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (!collaborators) return null;
  const { data, error, reload, setData } = collaborators;

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setAddError(null);
    const value = newEmail.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setEmailError('Ingresa un correo electrónico válido.');
      return;
    }
    setEmailError(undefined);
    setAdding(true);
    try {
      // The backend returns the full, updated list.
      const updated = await addCollaborator(project.id, value, newRole);
      setData(updated);
      setNewEmail('');
      setNotice('Colaborador agregado.');
    } catch (err) {
      const fields = fieldErrorsFrom(err);
      if (fields.email) setEmailError(fields.email);
      setAddError(describeError(err, 'collaborator-add'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: Collaborator) {
    setRemoveError(null);
    setNotice(null);
    setRemovingId(member.userId);
    try {
      await removeCollaborator(project.id, member.userId);
      if (data) setData(data.filter((c) => c.userId !== member.userId));
      setConfirmingId(null);
      setNotice(`${member.fullName} ya no es colaborador.`);
    } catch (err) {
      setRemoveError(describeError(err, 'collaborator-remove'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card
          title="Agregar colaborador"
          description="Solo usuarios con rol Investigador o Estudiante pueden ser colaboradores."
        >
          <form onSubmit={handleAdd} noValidate className="space-y-4">
            {addError && <Alert tone="error">{addError}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <Input
                label="Correo del colaborador"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                error={emailError}
                hint="El correo con el que la persona inició sesión en la plataforma."
                autoComplete="off"
                spellCheck={false}
                disabled={adding}
              />
              <Select
                label="Rol en el proyecto"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as CollaboratorRole)}
                disabled={adding}
              >
                <option value="MEMBER">{COLLABORATOR_ROLE_LABELS.MEMBER}</option>
                <option value="LEAD">{COLLABORATOR_ROLE_LABELS.LEAD}</option>
              </Select>
            </div>
            <Button type="submit" loading={adding}>
              {adding ? 'Agregando...' : 'Agregar colaborador'}
            </Button>
          </form>
        </Card>
      )}

      <section aria-label="Colaboradores del proyecto" aria-busy={collaborators.loading} className="space-y-3">
        <h2 className="text-lg font-semibold">Colaboradores</h2>
        {!canManage && notice && <Alert tone="success">{notice}</Alert>}
        {removeError && <Alert tone="error">{removeError}</Alert>}
        {error && !data ? (
          <div className="space-y-3">
            <Alert tone="error">{describeError(error)}</Alert>
            <Button variant="secondary" onClick={reload}>
              Reintentar
            </Button>
          </div>
        ) : !data ? (
          <Spinner label="Cargando colaboradores..." />
        ) : data.length === 0 ? (
          <EmptyState title="Aún no hay colaboradores" />
        ) : (
          <ul className="space-y-3">
            {data.map((member) => (
              <li key={member.userId}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">
                        {member.fullName}
                        {member.userId === userId && <span className="font-normal text-slate-500"> (tú)</span>}
                      </p>
                      <p className="break-all text-xs text-slate-600">
                        {member.email} · {ROLE_LABELS[member.userRole]} · desde {formatDate(member.addedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {member.isOwner && <Badge tone="info">Dueño</Badge>}
                      <Badge tone={member.role === 'LEAD' ? 'success' : 'neutral'}>
                        {COLLABORATOR_ROLE_LABELS[member.role]}
                      </Badge>
                      {canManage && !member.isOwner && (
                        confirmingId === member.userId ? (
                          <>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={removingId === member.userId}
                              onClick={() => handleRemove(member)}
                              aria-label={`Confirmar quitar a ${member.fullName}`}
                            >
                              Confirmar
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={removingId === member.userId}
                              onClick={() => setConfirmingId(null)}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Quitar a ${member.fullName}`}
                            onClick={() => {
                              setRemoveError(null);
                              setConfirmingId(member.userId);
                            }}
                          >
                            Quitar
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
