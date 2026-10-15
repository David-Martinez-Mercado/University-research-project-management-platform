// Tests ALWAYS run against a local throwaway database, never the one in .env (which may be Render).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://urpmp:urpmp_dev_password@localhost:5544/urpmp_test?schema=public';

export function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run tests against non-local database host "${host}"`);
  }
}
