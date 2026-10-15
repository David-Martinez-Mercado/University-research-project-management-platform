# University-research-project-management-platform
A comprehensive platform for research project management and development, designed to enhance academic and scientific work through the use of Artificial Intelligence (AI) and advanced Retrieval-Augmented Generation (RAG) techniques.

## Estructura

| Ruta | Contenido |
|---|---|
| `.claude/agents/` | Subagentes de Claude Code: `db-engineer`, `auth-backend`, `business-backend`, `frontend-ui` |
| `PLAN.md` | Plan de trabajo semanal (12–18 oct 2026) |
| `backend/` | API Node.js/Express + Prisma (esquema y migraciones en `backend/prisma/`) |
| `docs/DATABASE.md` | Base de datos: setup local, Render, supuestos de modelado |
| `docker-compose.yml` | PostgreSQL 16 + pgvector para desarrollo local |

## Estado

- [x] Fase 1 — Base de datos (`db-engineer`): ver `docs/DATABASE.md`
- [ ] Fase 2 — Auth & RBAC (`auth-backend`)
- [ ] Fase 3 — Módulos de negocio (`business-backend`) y Frontend (`frontend-ui`)
