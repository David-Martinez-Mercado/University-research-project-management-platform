# Base de datos

PostgreSQL 15+ con `pgvector`, gestionado con migraciones versionadas de **Prisma** (`backend/prisma/`).

## Desarrollo local

```bash
docker compose up -d db                      # PostgreSQL 16 + pgvector en localhost:5544
cd backend
cp .env.example .env                         # DATABASE_URL ya apunta al contenedor local
npm install
npx prisma migrate deploy                    # aplica las migraciones
npm run db:smoke                             # prueba de humo (hace rollback, no deja datos)
```

## Aprovisionamiento en Render (producción)

> Pendiente de ejecutar por el dueño de la cuenta de Render: requiere credenciales que no están en el repo.

1. Render Dashboard → **New → PostgreSQL** (o `render.yaml` de la raíz como Blueprint). Versión 15+.
2. Copiar la *Internal Database URL* (backend en Render) o *External Database URL* (desde tu máquina) y guardarla **solo** como variable de entorno `DATABASE_URL` en Render / en un `.env` local (ignorado por git). Añadir `?sslmode=require` a la URL externa.
3. La migración inicial ejecuta `CREATE EXTENSION IF NOT EXISTS "vector"`; Render permite `pgvector` en sus instancias administradas, no hace falta habilitarlo a mano.
4. `npx prisma migrate deploy` contra esa URL, y `npm run db:smoke` para validar.

## Entidades (12)

`users, projects, project_collaborators, documents, document_chunks, evaluation_criteria, judge_assignments, evaluations, investor_project_links, notifications, ai_interaction_logs, retrieval_audit_logs`

`USER` se mapea a la tabla `users` porque `user` es palabra reservada en PostgreSQL.

## Índices

- **HNSW** sobre `document_chunks.embedding_vector` (`vector_cosine_ops`, `m=16`, `ef_construction=64`) — NFR-002. Definido a mano en el SQL de la migración (Prisma no puede expresarlo). Verificado con `EXPLAIN` en `npm run db:smoke`.
- Índice en cada llave foránea (declarados con `@@index`/`@@unique` en `schema.prisma`).

## Supuestos (el diccionario de datos del Design Document no estaba en el repo)

El Design Document (.docx, 27 págs.) no está disponible para el agente, por lo que las columnas se infirieron de la lista de entidades y de los requerimientos citados. **Contrastar con el diccionario de datos y corregir con una nueva migración si difiere.**

| Supuesto | Motivo |
|---|---|
| IDs `uuid`; fechas `timestamptz` | Convención por defecto. |
| `embedding_vector` = `vector(1536)` | Dimensión de `text-embedding-3-small`. Si el modelo de embeddings cambia, hay que migrar y re-embeber. pgvector indexa hasta 2000 dims con HNSW. |
| Distancia coseno para el índice HNSW | Estándar para embeddings de texto. Las consultas deben usar `<=>`. |
| `ProjectStatus`: `DRAFT → SUBMITTED → UNDER_EVALUATION → EVALUATED → ARCHIVED` | El plan solo da `Draft → Submitted → Under evaluation → …`; los estados posteriores son una suposición. Las transiciones válidas las impone `business-backend`. |
| `users.affiliation` y `projects.affiliation` | Necesarios para el chequeo de conflicto de interés de jueces (FR-010). |
| `users.failed_login_count / first_failed_login_at / locked_until` | Bloqueo tras 5 intentos en 10 min (NFR-013). |
| `users.is_owner` | Identifica al Administrador creado por `/auth/bootstrap-owner`. |
| `evaluations` = una fila por (asignación, criterio), con `status DRAFT/SUBMITTED` | Soporta recuperación de borrador (FR-029). |
| `investor_project_links` única por (inversionista, proyecto) | Alcance del dashboard de inversionista (BR-007). |
| `retrieval_audit_logs` enlaza interacción de IA ↔ chunk con `similarity_score` y `rank` | Auditoría de recuperación RAG. |
| Borrado: `RESTRICT` para autores/propietarios; `CASCADE` para datos dependientes (chunks, colaboradores, evaluaciones…) | Evitar perder registros de auditoría o usuarios con actividad. |
