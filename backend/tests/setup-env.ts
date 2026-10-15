import { assertLocal, TEST_DATABASE_URL } from './test-db';

// Runs before any test file imports the app, so config reads these values (dotenv never
// overrides variables that are already set).
assertLocal(TEST_DATABASE_URL);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.BCRYPT_ROUNDS = '4';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.BOOTSTRAP_OWNER_SECRET = '';
process.env.JWT_INACTIVITY_MINUTES = '30';
process.env.LOGIN_MAX_FAILED_ATTEMPTS = '5';
process.env.LOGIN_FAILURE_WINDOW_MINUTES = '10';
process.env.LOCKOUT_MINUTES = '15';
