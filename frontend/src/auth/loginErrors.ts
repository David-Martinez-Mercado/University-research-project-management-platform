import { ApiError } from '../api/client';

export interface LoginFailure {
  /** Message for the whole form. */
  form?: string;
  /** Per-field messages (server-side validation). */
  fields?: { email?: string; password?: string };
}

function retryText(seconds: number | undefined, fallback: string): string {
  if (!seconds) return fallback;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Inténtalo de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}

/**
 * Turns a failed login into user-facing text. The 401 text is deliberately identical for
 * "unknown email" and "wrong password" so the UI never reveals whether an account exists.
 */
export function describeLoginError(err: unknown): LoginFailure {
  if (!(err instanceof ApiError)) return { form: 'Algo salió mal. Inténtalo de nuevo.' };

  switch (err.status) {
    case 0:
      return { form: 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.' };
    case 400: {
      const fields: LoginFailure['fields'] = {};
      for (const issue of err.body.details ?? []) {
        if (issue.path === 'email') fields.email ??= 'Ingresa un correo electrónico válido.';
        if (issue.path === 'password') fields.password ??= 'Ingresa tu contraseña.';
      }
      return Object.keys(fields).length > 0
        ? { fields }
        : { form: 'Revisa la información que ingresaste.' };
    }
    case 401:
      return { form: 'Correo electrónico o contraseña incorrectos.' };
    case 423:
      return {
        form: `Demasiados intentos fallidos: la cuenta está bloqueada temporalmente. ${retryText(err.body.retryAfterSeconds, 'Inténtalo más tarde.')}`,
      };
    case 429:
      return {
        form: `Demasiadas solicitudes. ${retryText(err.body.retryAfterSeconds, 'Espera unos minutos e inténtalo de nuevo.')}`,
      };
    default:
      return { form: 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.' };
  }
}
