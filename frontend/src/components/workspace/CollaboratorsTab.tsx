import { useState, type FormEvent } from 'react';
import { addCollaborator, removeCollaborator, updateCollaboratorRole } from '../../api/projects';
import type { Collaborator, CollaboratorRole } from '../../api/types';
import { describeError, fieldErrorsFrom } from '../../lib/errors';
import { COLLABORATOR_ROLE_LABELS, formatDate } from '../../lib/labels';
import { ROLE_LABELS } from '../../lib/roles';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '../ui';
import type { WorkspaceContext } from './types';

// Light client-side check; the server is the authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PERMISSIONS: CollaboratorRole[] = ['EDITOR', 'VIEWER'];

/**
 * Collaborators and what each may do. Only the owner (and an administrator) adds, removes and changes permissions:
 * EDITOR = view and edit, VIEWER = read-only. The backend enforces it; this screen only shows the controls to those who may use them.
 */
export function CollaboratorsTab({ project, canManage, canEdit, userId, collaborators }: WorkspaceContext) {
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<CollaboratorRole>('EDITOR');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

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
      setNotice('Colaborador agregado. Ya puede entrar al proyecto.');
    } catch (err) {
      const fields = fieldErrorsFrom(err);
      if (fields.email) setEmailError(fields.email);
      setAddError(describeError(err, 'collaborator-add'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: Collaborator) {
    setListError(null);
    setNotice(null);
    setRemovingId(member.userId);
    try {
      await removeCollaborator(project.id, member.userId);
      if (data) setData(data.filter((c) => c.userId !== member.userId));
      setConfirmingId(null);
      setNotice(`${member.fullName} ya no es colaborador.`);
    } catch (err) {
      setListError(describeError(err, 'collaborator-remove'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handlePermission(member: Collaborator, role: CollaboratorRole) {
    if (role === member.role) return;
    setListError(null);
    setNotice(null);
    setUpdatingId(member.userId);
    try {
      setData(await updateCollaboratorRole(project.id, member.userId, role));
      setNotice(`${member.fullName}: ${COLLABORATOR_ROLE_LABELS[role].toLowerCase()}.`);
    } catch (err) {
      setListError(describeError(err, 'collaborator-update'));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!canManage && (
        <Alert tone="info">
          {canEdit
            ? 'Tienes permiso para editar este proyecto. Solo el dueño puede agregar personas o cambiar permisos.'
            : 'Tienes permiso de solo lectura en este proyecto. Solo el dueño puede cambiar los permisos.'}
        </Alert>
      )}

      {canManage && (
        <Card
          title="Agregar colaborador"
          description="La persona debe tener una cuenta de Usuario en la plataforma (puede crearla ella misma en «Crear cuenta»). Tú decides si puede editar o solo ver."
        >
          <form onSubmit={handleAdd} noValidate className="space-y-4">
            {addError && <Alert tone="error">{addError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
              <Input
                label="Correo del colaborador"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                error={emailError}
                hint="El correo con el que la persona se registró en la plataforma."
                autoComplete="off"
                spellCheck={false}
                disabled={adding}
              />
              <Select
                label="Permiso"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as CollaboratorRole)}
                disabled={adding}
              >
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {COLLABORATOR_ROLE_LABELS[p]}
                  </option>
                ))}
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
        {notice && <Alert tone="success">{notice}</Alert>}
        {listError && <Alert tone="error">{listError}</Alert>}
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
                      {member.isOwner ? (
                        <>
                          <Badge tone="info">Dueño</Badge>
                          <Badge tone="success">Acceso completo</Badge>
                        </>
                      ) : canManage ? (
                        <div className="w-44">
                          <label htmlFor={`perm-${member.userId}`} className="sr-only">
                            Permiso de {member.fullName}
                          </label>
                          <select
                            id={`perm-${member.userId}`}
                            value={member.role}
                            disabled={updatingId === member.userId}
                            onChange={(e) => void handlePermission(member, e.target.value as CollaboratorRole)}
                            className="block w-full rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:bg-slate-100"
                          >
                            {PERMISSIONS.map((p) => (
                              <option key={p} value={p}>
                                {COLLABORATOR_ROLE_LABELS[p]}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <Badge tone={member.role === 'EDITOR' ? 'success' : 'neutral'}>
                          {COLLABORATOR_ROLE_LABELS[member.role]}
                        </Badge>
                      )}
                      {canManage &&
                        !member.isOwner &&
                        (confirmingId === member.userId ? (
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
                              setListError(null);
                              setConfirmingId(member.userId);
                            }}
                          >
                            Quitar
                          </Button>
                        ))}
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
