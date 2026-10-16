# Plan de trabajo para Claude Code (con agentes definidos) — Semana del 12 al 18 de octubre de 2026

**Proyecto:** University Research Project Management Platform
**Fuente:** fichas activas esta semana en Notion (base "University Research Project Management Platform")
**Generado:** jueves 15 de octubre de 2026

---

## 0. Agentes

Este plan usa 4 subagentes de Claude Code, definidos en `.claude/agents/`:

- `db-engineer.md`
- `auth-backend.md`
- `business-backend.md`
- `frontend-ui.md`

---

## 1. Alerta y orden de prioridad

**La ficha "Base de datos — Modelado y configuración" venció ayer (14 de octubre) y sigue en "Sin empezar" en Notion.** Es la prioridad #1 absoluta: bloquea todo el desarrollo de backend. Antes de tocar cualquier otra cosa, ciérrala hoy con `db-engineer`.

| Orden | Fase (ficha de Notion) | Agente | Depende de |
|---|---|---|---|
| 1 | Base de datos — Modelado y configuración (vencida) | `db-engineer` | — |
| 2 | Backend — Auth & RBAC y núcleo de API | `auth-backend` | `db-engineer` |
| 3 | Backend — Módulos de negocio | `business-backend` | `auth-backend` |
| 3 | Frontend — Interfaces por rol | `frontend-ui` | `auth-backend` (puede usar mocks mientras tanto) |

Los dos de prioridad 3 pueden correr en paralelo una vez que `auth-backend` tenga login + middleware RBAC funcionando.

*(IA/RAG — Pipeline, Pruebas y Despliegue no entran esta semana: empiezan el 22 de octubre o después; no tienen agente definido todavía.)*

---

## 2. `db-engineer` — Base de datos — Modelado y configuración

**Vencimiento original:** 14 oct (vencida) · **Prioridad:** Alta

- [x] Instancia de PostgreSQL en Render con `pgvector` habilitado (migraciones y `db:smoke` verificados contra Render el 15 oct 2026).
- [x] Migraciones versionadas de las 12 entidades + llaves foráneas.
- [x] Índice HNSW sobre `DOCUMENT_CHUNK.embedding_vector` (NFR-002) + índices de las demás FK.
- [x] `.env.example` documentado, sin credenciales reales.
- [x] Prueba de carga/consulta básica verificada (`npm run db:smoke`).

**No avanzar a `auth-backend` hasta que esto esté verificado, no solo escrito.**

---

## 3. `auth-backend` — Backend — Auth & RBAC y núcleo de API

**Ventana:** 08–21 oct · **Prioridad:** Alta · **Depende de:** `db-engineer`

- [x] Scaffolding Express por módulos.
- [x] `POST /auth/login`.
- [x] `POST /auth/bootstrap-owner`.
- [x] Middleware JWT (expiración por 30 min de inactividad).
- [x] Middleware RBAC (revalida rol y propiedad en cada request, denegación por defecto — FR-030).
- [x] Bloqueo de cuenta tras 5 intentos fallidos en 10 minutos (NFR-013).
- [x] `POST /users`, `PUT /users/:id`.

**Hecho el 15 oct 2026** — 45 pruebas pasan, ver `docs/AUTH.md` (incluye decisiones a revisar).

---

## 4. `business-backend` — Backend — Módulos de negocio

**Ventana:** 15 oct–11 nov (arranca hoy) · **Prioridad:** Alta · **Depende de:** `auth-backend`

- [x] Modelo de Proyecto y ciclo de estado (`Draft → Submitted → Under evaluation → …`).
- [ ] Carga de documentos con validación de tipo y tamaño.
- [ ] Asignación de Jueces con verificación de conflicto de interés (FR-010).
- [ ] Flujo de evaluación con recuperación de borrador (FR-029).
- [ ] Dashboard de Inversionista con alcance limitado por proyecto vinculado (BR-007).
- [ ] Sistema de notificaciones in-app.

**Hecho el 16 oct 2026:** modelo de Proyecto, ciclo de estados, CRUD de `/projects` y colaboradores (82 pruebas pasan, ver `docs/PROJECTS.md`). Siguen abiertos: documentos, jueces/FR-010, evaluación/FR-029, dashboard de inversionista/BR-007 y notificaciones.

**Alcance realista esta semana:** modelo de Proyecto + CRUD básico de `/projects`. El resto sigue la próxima semana.

---

## 5. `frontend-ui` — Frontend — Interfaces por rol

**Ventana:** 08 oct–18 nov · **Prioridad:** Alta · **Depende de:** `auth-backend` (puede usar mocks)

- [ ] Scaffolding (Vite + React + TS + Tailwind).
- [ ] Librería de componentes compartida (botón, input, card, nav).
- [ ] Pantalla de Login conectada a `/auth/login` (real o mock marcado).
- [ ] Dashboard, Workspace del proyecto, Evaluación (Judge), Dashboard de Inversionista, Panel de Administración — continúan en sprints siguientes.

---

## 6. Calendario sugerido (jueves 15 – domingo 18 de octubre)

| Día | Agente en turno | Foco |
|---|---|---|
| **Jue 15 (hoy)** | `db-engineer` | Cerrar por completo la base de datos — único objetivo de hoy. |
| **Vie 16** | `auth-backend` | Scaffolding + `/auth/login` + `/auth/bootstrap-owner`. |
| **Sáb 17** | `auth-backend` | Middleware JWT + RBAC, bloqueo de cuenta, endpoints `/users`. Cerrar la ficha si alcanza. |
| **Dom 18** | `business-backend` y/o `frontend-ui` | En paralelo si Auth ya cerró: modelo de Proyecto y/o scaffolding + Login de frontend. Si Auth no cerró el sábado, el domingo se queda en `auth-backend` antes que nada. |

---

## 7. Al cerrar la semana

- Actualizar `Estado` en Notion de cada ficha trabajada (`Sin empezar` → `En progreso` o `Done`).
- Si alguna fecha se recorrió, ajustarla en la ficha y en la tabla de priorización del tablero de Miro.
- Las fichas de IA/RAG (22 oct), Pruebas (12 nov) y Despliegue (26 nov) siguen sin tocarse.
