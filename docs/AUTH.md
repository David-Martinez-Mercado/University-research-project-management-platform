# Autenticación y control de acceso

Implementado por el agente `auth-backend`. Código en `backend/src/{auth,users,middleware}/`.

## Ejecutar

```bash
docker compose up -d db          # BD local
cd backend
cp .env.example .env             # y fija DATABASE_URL + JWT_SECRET (>= 32 caracteres)
npm install
npx prisma migrate deploy
npm run dev                      # http://localhost:3000
npm test                         # 45 pruebas; usan SOLO la BD local urpmp_test
npm run typecheck
```

Las pruebas **se niegan a correr contra un host que no sea local**, así que nunca tocan la BD de Render aunque `.env` apunte allá.

## Endpoints

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `POST /auth/login` | público (rate-limit por IP) | `{email, password}` → `{token, expiresInSeconds, user}` |
| `POST /auth/bootstrap-owner` | público **una sola vez** | Crea el primer Administrador (`isOwner`). Con un owner existente responde **404**. En producción exige el header `x-bootstrap-secret` = `BOOTSTRAP_OWNER_SECRET`. |
| `GET /auth/me` | autenticado | Usuario actual |
| `POST /users` | ADMINISTRATOR | Crea usuario con rol |
| `PUT /users/:id` | ADMINISTRATOR | Edita nombre, rol, afiliación, `isActive`, reinicia contraseña (`password`) o desbloquea (`unlockAccount: true`) |
| `GET /users/:id` | ADMINISTRATOR o el propio usuario | Ejemplo de regla de propiedad |
| `GET /health` | público | Estado |

## Cómo funciona

- **Expiración por inactividad (30 min):** el JWT dura 30 min, y **cada request autenticado devuelve un token nuevo** en el header `X-Auth-Token`. El frontend debe reemplazar el token guardado con ese valor; si pasan 30 min sin actividad, el token expira. El token solo lleva el `id` del usuario.
- **RBAC (FR-030):** `authorize({ roles, ownership })` en `middleware/authorize.ts`. En **cada** request relee el usuario en la BD (rol, `isActive`), así que cambios de rol o desactivaciones aplican de inmediato a tokens ya emitidos. **Denegación por defecto:** sin regla configurada, regla que falla o que lanza excepción → 403.
- **Bloqueo de cuenta (NFR-013):** 5 intentos fallidos en 10 min bloquean la cuenta 15 min (`423` + `Retry-After`). El contador se actualiza con un único `UPDATE` atómico, de modo que intentos en paralelo no lo esquivan. Un login correcto lo reinicia. Un admin puede desbloquear.
- **Contraseñas:** bcrypt (`bcryptjs`, 12 rondas), mínimo 10 caracteres y máximo 72 bytes (límite de bcrypt). Nunca se devuelven ni se registran. Login responde igual para email inexistente y contraseña errónea (y hace un `compare` ficticio para igualar tiempos).
- **Owner único:** índice único parcial `users_single_owner_idx` en la BD: aunque lleguen bootstrap concurrentes, solo uno gana (probado).
- El owner no puede ser degradado ni desactivado vía API.

## Decisiones a revisar

| Decisión | Alternativa |
|---|---|
| Token ausente/inválido/expirado → **401**; rol insuficiente → **403** | La ficha dice "default 403" para token ausente. Cambiar es una línea en `middleware/authenticate.ts`. |
| Duración del bloqueo: 15 min (`LOCKOUT_MINUTES`) | La ficha no la define. |
| `bootstrap-owner` exige secreto en producción | Sin él, quien llegue primero al endpoint desplegado sería el Administrador. |
| Ventana deslizante vía `X-Auth-Token` | Alternativa: refresh tokens con sesión en BD (permite revocar). |
| El bloqueo de cuenta no invalida tokens ya emitidos | Solo desactivar (`isActive=false`) los invalida. |

## Migraciones y Prisma

`20261015150000_users_single_owner` agrega el índice parcial a mano. Prisma no puede representar ni este índice ni el HNSW de `document_chunks`, así que `prisma migrate diff` / `migrate dev` propondrán `DROP INDEX "document_chunks_embedding_vector_hnsw_idx"`. **Nunca aceptes ese DROP**; borra esa línea de cualquier migración autogenerada.
