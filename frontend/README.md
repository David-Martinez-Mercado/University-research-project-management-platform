# Frontend - University Research Project Management Platform

React 19 + TypeScript + Tailwind CSS 4 on Vite 8. Tests with Vitest + Testing Library.

## Status

| Screen | State |
|---|---|
| Login (`/login`, real `POST /auth/login`) | done |
| Dashboard shell (`/`, real `GET /auth/me`, minimal, same for every role) | done (minimal) |
| Per-role dashboards, project workspace, evaluation (Judge), investor dashboard, admin panel | open (later sprints) |

## Run

```bash
cd frontend
cp .env.example .env     # optional; defaults already match the dev API
npm install
npm run dev              # http://localhost:5173 (strictPort: fails if the port is taken)
```

The API must allow the origin `http://localhost:5173` (the backend default `CORS_ORIGIN`).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | type-check + production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (jsdom) |
| `npm run preview` | serves `dist/` |

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend base URL (no trailing slash). Read at build time. |
| `VITE_USE_MOCKS` | `false` | `true` serves `/auth/login` and `/auth/me` from `src/mocks/` and shows a "MOCK API" banner. |

Mock accounts (password `mock-password-1`): `researcher@`, `student@`, `judge@`, `investor@`, `admin@` + `mock.test`;
`locked@mock.test` always answers 423 (9 minutes); any other credentials answer 401.
Mock code is only bundled when `VITE_USE_MOCKS=true`; a normal production build contains none of it.

## Structure

```
src/
  api/          fetch client (base URL, bearer token, sliding session, 401 handling), endpoint functions, types
  auth/         AuthContext (session state), ProtectedRoute, tokenStore, login error messages
  components/ui Shared library: Button, Input, Card, Alert, AppShell (top bar: app name, user, role, logout)
  mocks/        MOCK API (fetch replacement, fixtures, banner) - only active with VITE_USE_MOCKS=true
  pages/        LoginPage, DashboardPage
  lib/          small helpers (class names, role labels)
  test/         Vitest setup and helpers
```

Both screens are built from the same `components/ui` pieces (AppShell, Card, Button, Input, Alert). New screens must
reuse them rather than styling their own.

## Session handling

- `POST /auth/login` returns `{ token, expiresInSeconds, user }`; the token is sent as `Authorization: Bearer <token>`.
- **Sliding session:** every authenticated response carries a fresh JWT in `X-Auth-Token` (30 minutes of
  inactivity). `api/client.ts` replaces the stored token on every response. The swap is ignored when no session is
  stored, so a late response cannot revive a session that was just logged out.
- **401 on an authenticated call** clears the session and redirects to `/login` with a "session expired" notice.
  A 401 from `/auth/login` itself is just "invalid credentials" and never touches the session.
- Reloading the page restores the session by calling `GET /auth/me` with the stored token.
- Login errors: 400 maps server field issues onto the inputs; 401 shows one generic message (identical for unknown
  email and wrong password); 423 shows the minutes remaining (`retryAfterSeconds`); 429 shows a rate-limit message.

## Token storage and the XSS trade-off

The token lives in **`sessionStorage`**, behind `src/auth/tokenStore.ts` (the only module that touches it), so the
strategy can change in one place.

- Survives reloads of the tab, is dropped when the tab/browser closes, and is not shared across tabs.
- Readable by any script that runs in the page, so an XSS bug would expose it (same as `localStorage`).
- Alternatives considered: in-memory only (safer against XSS but logs the user out on every reload) and an
  `httpOnly` cookie (safest against XSS but needs backend changes: cookie issuing and CSRF protection).
- Mitigations in place: React escapes all rendered text and the app uses no `dangerouslySetInnerHTML`; the token
  expires after 30 minutes without activity; the backend re-reads role and active flag on every request, so a
  deactivated user's token stops working immediately. Keep dependencies minimal and add a strict CSP when the app
  is deployed.

## Known notes

- The backend answers 423 only for existing accounts, so a locked-account message can confirm that an email exists.
  This is a backend design property; the UI cannot hide it without the backend changing the response.
