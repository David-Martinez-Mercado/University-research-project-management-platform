import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, BrandMark, Button, Input } from '../components/ui';
import { describeError, fieldErrorsFrom } from '../lib/errors';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 10;

/**
 * Public signup. It always creates a "Usuario" (investigador / estudiante): the role is never sent, and the backend rejects it
 * if someone tries. Reviewers (judges, investors) are created by an administrator.
 */
export function SignupPage() {
  const { status, signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!fullName.trim()) local.fullName = 'Ingresa tu nombre completo.';
    if (!EMAIL_PATTERN.test(email.trim())) local.email = 'Ingresa un correo electrónico válido.';
    if (password.length < MIN_PASSWORD) local.password = `Usa al menos ${MIN_PASSWORD} caracteres.`;
    else if (confirm !== password) local.confirm = 'Las contraseñas no coinciden.';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setSubmitting(true);
    try {
      await signUp({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        ...(affiliation.trim() ? { affiliation: affiliation.trim() } : {}),
      });
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      setFormError(describeError(err, 'signup'));
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-8">
      <main id="contenido" className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <BrandMark />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Crear cuenta</h1>
        <p className="mt-2 text-sm text-slate-600">
          Para investigadores y estudiantes. Podrás crear tus proyectos y colaborar en los de otras personas.
        </p>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-8 space-y-1 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {formError && <Alert tone="error">{formError}</Alert>}
          <Input
            label="Nombre completo"
            name="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.fullName}
            disabled={submitting}
          />
          <Input
            label="Correo electrónico"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            disabled={submitting}
          />
          <Input
            label="Institución o área (opcional)"
            name="affiliation"
            autoComplete="organization"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            error={errors.affiliation}
            hint="Se usa para evitar conflictos de interés al asignar revisores."
            disabled={submitting}
          />
          <Input
            label="Contraseña"
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={`Mínimo ${MIN_PASSWORD} caracteres.`}
            disabled={submitting}
          />
          <Input
            label="Confirmar contraseña"
            type="password"
            name="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
            disabled={submitting}
          />
          <div className="pt-2">
            <Button type="submit" fullWidth loading={submitting}>
              {submitting ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Inicia sesión
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          ¿Eres revisor (juez o de seguimiento de avances)? Tu cuenta la crea un administrador, que te entregará tu usuario.
        </p>
      </main>
    </div>
  );
}
