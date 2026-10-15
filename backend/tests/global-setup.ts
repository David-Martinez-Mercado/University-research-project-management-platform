import { execSync } from 'node:child_process';
import { assertLocal, TEST_DATABASE_URL } from './test-db';

// Creates the test database if needed and applies all migrations to it.
export default function setup() {
  assertLocal(TEST_DATABASE_URL);
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer };
    throw new Error(
      'Could not prepare the test database. Is the local DB running (`docker compose up -d db`)?\n' +
        (e.stderr?.toString() || e.stdout?.toString() || String(err)),
    );
  }
}
