import { useState, type FormEvent } from 'react';
import { createUser, updateUser } from '../../api/users';
import { ROLES, type Role, type User } from '../../api/types';
import { Alert, Button, Input, Select } from '../ui';
import { describeError, fieldErrorsFrom } from '../../lib/errors';
import { ROLE_LABELS } from '../../lib/roles';

interface Props {
  /** Present = edit this user; absent = create a new one. */
  user?: User;
  onSaved: (user: User) => void;
  onCancel: () => void;
}

const MIN_PASSWORD = 10;

export function UserForm({ user, onSaved, onCancel }: Props) {
  const editing = !!user;
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'RESEARCHER');
  const [affiliation, setAffiliation] = useState(user?.affiliation ?? '');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [unlock, setUnlock] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!fullName.trim()) local.fullName = 'Ingresa el nombre completo.';
    if (!editing && !/^\S+@\S+\.\S+$/.test(email.trim())) local.email = 'Ingresa un correo válido.';
    if (!editing && password.length < MIN_PASSWORD) local.password = `Mínimo ${MIN_PASSWORD} caracteres.`;
    if (editing && password && password.length < MIN_PASSWORD) local.password = `Mínimo ${MIN_PASSWORD} caracteres.`;
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setSaving(true);
    try {
      const saved = user
        ? await updateUser(user.id, {
            fullName: fullName.trim(),
            role,
            affiliation: affiliation.trim() || null,
            isActive,
            ...(password ? { password } : {}),
            ...(unlock ? { unlockAccount: true as const } : {}),
          })
        : await createUser({
            fullName: fullName.trim(),
            email: email.trim(),
            password,
            role,
            ...(affiliation.trim() ? { affiliation: affiliation.trim() } : {}),
          });
      onSaved(saved);
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(describeError(err, 'user-save'));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={editing ? 'Editar usuario' : 'Nuevo usuario'}>
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Input
          label="Nombre completo"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
          disabled={saving}
        />
        <Input
          label="Correo electrónico"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          disabled={saving || editing}
          hint={editing ? 'El correo no se puede cambiar.' : undefined}
        />
        <Select label="Rol" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={saving}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Input
          label="Afiliación"
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          error={errors.affiliation}
          disabled={saving}
          hint="Se usa para detectar conflicto de interés al asignar jueces."
        />
        <Input
          label={editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={saving}
          hint={`Mínimo ${MIN_PASSWORD} caracteres.`}
        />
      </div>
      {editing && (
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={saving}
            />
            Cuenta activa
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={unlock}
              onChange={(e) => setUnlock(e.target.checked)}
              disabled={saving}
            />
            Desbloquear cuenta (borra intentos fallidos)
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" loading={saving}>
          {editing ? 'Guardar cambios' : 'Crear usuario'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
