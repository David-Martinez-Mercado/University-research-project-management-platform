# Frontend - University Research Project Management Platform

React 19 + TypeScript + Tailwind CSS 4 on Vite 8. Tests with Vitest + Testing Library. The UI is in Spanish.

## Status

| Screen | State |
|---|---|
| Login (split layout, `POST /auth/login`) | done |
| Dashboard per role (`GET /projects`; investors get their own dashboard) | done |
| Create project, project workspace (Vista general, Documentos, Colaboradores, Rúbrica) | done |
| Workspace "Mi evaluación" (judge: draft recovery, confirmation before final submit) | done |
| Workspace "Asistente IA" (AI-generated label, sources, "Reportar respuesta incorrecta", fallback, outage message) | done |
| Workspace "Progreso" (milestones + progress bar, locked once under evaluation) | done |
| Workspace "Resultados" (hidden until the evaluation closes; PDF report for investor/judge/admin) | done |
| Investor dashboard (`/investors/:id/dashboard`: status/area/date filters, PDF export) | done |
| Notifications (`/notifications`, unread counter in the sidebar, polled every 60 s) | done |
| Admin: Usuarios, Criterios, Asignación de jueces, Inversionistas, Actividad de IA | done |
| Visual identity (UNIPOLI purple/orange/green, sidebar shell, responsive) | done |

## Run

```bash
cd frontend
cp .env.example .env     # optional; defaults already match the dev API
npm install
npm run dev              # http://localhost:5173 (strictPort: fails if the port is taken)
```

The API must allow the origin of the page through its `CORS_ORIGIN` (the backend default is `http://localhost:5173`).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | type-check + production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (jsdom) |
| `npm run preview` | serves `dist/` |

## Configuration (`.env`, read at build time)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend base URL (no trailing slash). |
| `VITE_USE_MOCKS` | `false` | `true` simulates ONLY the documents endpoints in memory and shows a visible "API SIMULADA" banner. |

### Mocks

Everything that exists in the backend (login, `/auth/me`, projects, collaborators, and now documents) uses the **real API**
in the default build. The only mock is `src/mocks/mockFetch.ts`, for `GET/POST /projects/:id/documents` and
`GET /projects/:id/documents/:docId/download`, meant for working while the documents backend is not deployed.

- Active only with `VITE_USE_MOCKS=true`; any other request is passed straight to the real `fetch`, so login and projects stay real
  (you need a running backend either way).
- Documents live in memory (reloading the page clears them). The mock mirrors the contract: 415 for an unsupported extension, 400 for a bad type,
  413 over 10 MB, ingestion status advancing PENDING -> PROCESSING -> READY with time.
- The mock code is dynamically imported behind a literal `import.meta.env.VITE_USE_MOCKS === 'true'` check, so a normal
  production build does not contain it (checked: the string "API SIMULADA" is absent from `dist/`).
- To retire it: delete `src/mocks/`, the flag in `src/api/client.ts` (`getFetch`) and the banner in `src/App.tsx`.

## Roles, routes and navigation

| Route | Screen | Who (UI) | Notes |
|---|---|---|---|
| `/login` | Login | everyone | |
| `/` | Dashboard | all roles | Same component; `GET /projects` is scoped by the backend. |
| `/projects/new` | Create project | RESEARCHER, ADMINISTRATOR | Others are redirected to `/` (backend answers 403 anyway). |
| `/projects/:id` | Workspace | all roles | 404 shows "no encontrado o sin acceso". Tab kept in `?tab=`. |

| Role | Dashboard | Navigation | Workspace tabs |
|---|---|---|---|
| ADMINISTRATOR | all projects, count per status, status filter | Proyectos, Nuevo proyecto | Vista general, Documentos, Colaboradores, IA, Progreso |
| RESEARCHER | own + collaborating projects, "Nuevo proyecto" | Mis proyectos, Nuevo proyecto | same as admin |
| STUDENT | projects where added as collaborator (no create) | Mis proyectos | same as admin |
| JUDGE | assigned projects (read-only) | Proyectos asignados | no Colaboradores; Documentos read-only |
| INVESTOR | linked projects (read-only) | Proyectos vinculados | no Documentos, no Colaboradores |

The per-role configuration lives in `src/lib/roleViews.ts`. It is only a UI convenience (what to show); the **backend authorizes
every call**, and the client never filters the project list itself (it renders what `GET /projects` returns).

Controls shown in the workspace are derived from data the backend returned: edit is offered to the owner / a LEAD collaborator
(from `GET /projects/:id/collaborators`) / an administrator, only in DRAFT (administrators in any status); status buttons are the
backend's `allowedNextStatuses` narrowed by `src/lib/lifecycle.ts` (a mirror of the transition table: submit/withdraw = manager,
evaluation steps and archive = administrator). 403/404/409/422 answers are shown in plain language (`src/lib/errors.ts`).
Documents can be uploaded only in DRAFT or SUBMITTED (the backend answers 409 otherwise, so the form is hidden with an explanation).

## Structure

```
src/
  api/          fetch client (base URL, bearer token, sliding session, 401, JSON/multipart/blob), endpoint modules, types
  auth/         AuthContext (session), ProtectedRoute, tokenStore, login error messages
  components/
    ui/         Shared library: Button, ButtonLink, Input, Select, Textarea (Field), Card, Alert, Badge, Spinner,
                EmptyState, Pagination, Tabs (WAI-ARIA), AppShell (top bar + role nav + skip link)
    workspace/  Tabs of the project workspace (Overview, Documents, Collaborators, Placeholder)
    *.tsx       Domain pieces built on ui/: ProjectForm (create + edit), ProjectList, badges, RoleShell
  lib/          roleViews (per-role copy/nav), lifecycle (transition mirror), errors (API error -> Spanish), labels,
                useAsync, saveBlob, roles, cx
  mocks/        MOCK documents API (only with VITE_USE_MOCKS=true) + banner
  pages/        LoginPage, DashboardPage, CreateProjectPage, ProjectWorkspacePage
  test/         Vitest setup and helpers (stubApi routes fetch by "METHOD /path")
```

New screens must reuse `components/ui` rather than styling their own buttons/cards.

## Session handling

- `POST /auth/login` returns `{ token, expiresInSeconds, user }`; the token is sent as `Authorization: Bearer <token>`.
- **Sliding session:** every authenticated response carries a fresh JWT in `X-Auth-Token` (30 minutes of inactivity). One code
  path in `api/client.ts` (`send`) is used by JSON calls, multipart uploads and blob downloads, so all of them replace the stored
  token. The swap is ignored when no session is stored, so a late response cannot revive a session that was just logged out.
- **401 on an authenticated call** clears the session and redirects to `/login` with a "session expired" notice.
  A 401 from `/auth/login` itself is just "invalid credentials" and never touches the session.
- Reloading the page restores the session by calling `GET /auth/me` with the stored token.
- Login errors: 400 maps server field issues onto the inputs; 401 shows one generic message (identical for unknown email and wrong
  password); 423 shows the minutes remaining (`retryAfterSeconds`); 429 shows a rate-limit message.
- Downloads cannot use a bare `<a href>` (they need the bearer token): the file is fetched as a Blob and saved through a temporary
  object URL (`lib/saveBlob.ts`).

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

## Accessibility and responsive notes

- Tabs follow the WAI-ARIA pattern (tablist/tab/tabpanel, roving tabindex, Left/Right/Home/End, automatic activation).
- Status, ingestion and role badges always carry a text label (never color alone); async results use `role="status"` / `role="alert"`
  (Alert) or `aria-live` regions; forms link label, hint and error with `aria-describedby`; visible `focus-visible` outlines; skip link.
- Layouts wrap (no fixed widths); the navigation, tab bar and cards reflow at phone width.

## Known notes and backend gaps

- The backend answers 423 only for existing accounts, so a locked-account message can confirm that an email exists (a backend
  design property).
- Collaborators are added **by email** (`POST /projects/:id/collaborators` takes `{email, role}`; the backend also still accepts
  `{userId, role}`). For unknown, inactive or wrong-role emails the backend answers the same generic 404, so the form shows one
  message for all three (this avoids revealing which emails are registered).
- `GET /projects/:id` has no `canManage`/`myRole` field, so the UI infers it (owner id, administrator, or LEAD in the
  collaborators list). Judges/investors cannot read collaborators (403), which is why they never see the owner's name.
- The project list/detail has no owner name (only `ownerId`); the owner name shown in Vista general comes from the collaborators list.
- No stats endpoint: the admin counts per status use one `GET /projects?status=X&limit=1` per status and read `total`.
- Documents are served by the real backend (`docs/DOCUMENTS_JUDGING.md`); the simulated documents API only runs with `VITE_USE_MOCKS=true`.
