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
  return `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Turns a failed login into user-facing text. The 401 text is deliberately identical for
 * "unknown email" and "wrong password" so the UI never reveals whether an account exists.
 */
export function describeLoginError(err: unknown): LoginFailure {
  if (!(err instanceof ApiError)) return { form: 'Something went wrong. Please try again.' };

  switch (err.status) {
    case 0:
      return { form: 'Unable to reach the server. Check your connection and try again.' };
    case 400: {
      const fields: LoginFailure['fields'] = {};
      for (const issue of err.body.details ?? []) {
        if (issue.path === 'email') fields.email ??= 'Enter a valid email address.';
        if (issue.path === 'password') fields.password ??= 'Enter your password.';
      }
      return Object.keys(fields).length > 0
        ? { fields }
        : { form: 'Please check the information you entered.' };
    }
    case 401:
      return { form: 'Invalid email or password.' };
    case 423:
      return {
        form: `Too many failed attempts: this account is temporarily locked. ${retryText(err.body.retryAfterSeconds, 'Try again later.')}`,
      };
    case 429:
      return {
        form: `Too many requests. ${retryText(err.body.retryAfterSeconds, 'Please wait a few minutes and try again.')}`,
      };
    default:
      return { form: 'The server had a problem. Please try again in a moment.' };
  }
}
