import { MOCK_LOCKED_EMAIL, MOCK_PASSWORD, MOCK_USERS } from './data';

/** Always visible while VITE_USE_MOCKS=true so mocked data can never be mistaken for real data. */
export function MockBanner() {
  return (
    <div role="status" className="bg-amber-400 px-4 py-1.5 text-center text-sm font-medium text-amber-950">
      MOCK API - no network requests are made. Try {MOCK_USERS[0].email} / {MOCK_PASSWORD}, or{' '}
      {MOCK_LOCKED_EMAIL} for a locked account.
    </div>
  );
}
