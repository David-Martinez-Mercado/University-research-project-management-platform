import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { describeLoginError, type LoginFailure } from '../auth/loginErrors';
import { Alert, AppShell, Button, Card, Input } from '../components/ui';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function validate(email: string, password: string): NonNullable<LoginFailure['fields']> {
  const fields: NonNullable<LoginFailure['fields']> = {};
  if (!EMAIL_PATTERN.test(email)) fields.email = 'Ingresa un correo electrónico válido.';
  if (!password) fields.password = 'Ingresa tu contraseña.';
  return fields;
}

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
    <AppShell>
      <div className="mx-auto w-full max-w-md">
        <Card title="Iniciar sesión" description="Usa tu cuenta de la plataforma universitaria.">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
        </Card>
      </div>
    </AppShell>
  );
}
