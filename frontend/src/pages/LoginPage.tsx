import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { describeLoginError, type LoginFailure } from '../auth/loginErrors';
import { Alert, BrandMark, Button, Icon, Input, type IconName } from '../components/ui';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function validate(email: string, password: string): NonNullable<LoginFailure['fields']> {
  const fields: NonNullable<LoginFailure['fields']> = {};
  if (!EMAIL_PATTERN.test(email)) fields.email = 'Ingresa un correo electrónico válido.';
  if (!password) fields.password = 'Ingresa tu contraseña.';
  return fields;
}

const HIGHLIGHTS: Array<{ icon: IconName; text: string }> = [
  { icon: 'folder', text: 'Todos tus proyectos y documentos en un solo lugar.' },
  { icon: 'scale', text: 'Evaluación con rúbricas claras y sin conflictos de interés.' },
  { icon: 'search', text: 'Un asistente de IA que responde con base en tus documentos.' },
];

export function LoginPage() {
  const { status, signIn, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<LoginFailure>({});
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const fields = validate(trimmedEmail, password);
    if (Object.keys(fields).length > 0) {
      setFailure({ fields });
      return;
    }
    setFailure({});
    setSubmitting(true);
    try {
      await signIn(trimmedEmail, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setFailure(describeLoginError(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="absolute -right-24 -top-24 size-80 rounded-full bg-accent-500/30 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-16 size-96 rounded-full bg-lime-brand/20 blur-3xl" />
        <div className="relative">
          <BrandMark light />
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            La investigación universitaria, <span className="text-accent-100">ordenada y a la vista.</span>
          </h2>
          <ul className="space-y-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.text} className="flex items-start gap-3 text-brand-100">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white">
                  <Icon name={h.icon} className="size-4" />
                </span>
                <span className="text-sm">{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-200">UNIPOLI · Ingeniería en Software</p>
      </aside>

      <main id="contenido" className="flex min-h-screen flex-col justify-center px-4 py-10 sm:px-8 lg:min-h-0">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Iniciar sesión</h1>
          <p className="mt-2 text-sm text-slate-600">Usa tu cuenta de la plataforma universitaria.</p>
          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {sessionExpired && !failure.form && (
              <Alert tone="info">Tu sesión expiró por inactividad. Inicia sesión de nuevo.</Alert>
            )}
            {failure.form && <Alert tone="error">{failure.form}</Alert>}
            <Input
              label="Correo electrónico"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={failure.fields?.email}
              disabled={submitting}
            />
            <Input
              label="Contraseña"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={failure.fields?.password}
              disabled={submitting}
            />
            <Button type="submit" fullWidth loading={submitting}>
              {submitting ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">
            ¿Necesitas una cuenta? Solicítala a un administrador.
          </p>
        </div>
      </main>
    </div>
  );
}
