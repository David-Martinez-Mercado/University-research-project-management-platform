# Gestión de proyectos (módulo `projects`)

Implementado por el agente `business-backend`. Código en `backend/src/projects/`, pruebas en `backend/tests/projects.test.ts`.

Alcance de este documento: **modelo de proyecto + ciclo de vida de estado + CRUD básico + colaboradores**. Los **documentos** y la **asignación de jueces/COI** se describen en `DOCUMENTS_JUDGING.md` (semana 2). Evaluaciones, dashboard de inversionistas y notificaciones **siguen abiertos** (semana 3).

## Endpoints

Todos pasan por `authorize(...)` (401 sin token válido, 403 por rol). Ninguno es público. Sin cambios de esquema ni migraciones.

| Método y ruta | Roles permitidos (puerta de rol) | Regla adicional (en el servicio) |
|---|---|---|
| `POST /projects` | RESEARCHER, ADMINISTRATOR | `ownerId` = quien llama (nunca del body). `affiliation` por defecto = la del creador. |
| `GET /projects` | los 5 roles | Solo filas visibles (ver *Alcance de lectura*). Query: `status`, `limit` (def. 20, tope 100), `offset`. Respuesta `{data,total,limit,offset}`. |
| `GET /projects/:id` | los 5 roles | Proyecto no visible o inexistente → **404** (idéntico). |
| `PUT /projects/:id` | ADMINISTRATOR, RESEARCHER, STUDENT | Visible (si no, 404) + dueño / LEAD / admin (si no, 403). Solo en `DRAFT` (409 si no); el admin puede editar en cualquier estado. |
| `PUT /projects/:id/status` | ADMINISTRATOR, RESEARCHER, STUDENT | Visible + dueño/LEAD/admin; luego la tabla de transiciones. |
| `GET /projects/:id/collaborators` | ADMINISTRATOR, RESEARCHER, STUDENT | Visible (si no, 404). Incluye al dueño como LEAD implícito (`isOwner: true`). |
| `POST /projects/:id/collaborators` | ADMINISTRATOR, RESEARCHER, STUDENT | Dueño / LEAD / admin. Body: **exactamente uno** de `userId` (UUID) o `email`, más `role?: LEAD\|MEMBER` (def. MEMBER). Con `email` (sin distinguir mayúsculas) un usuario inexistente, inactivo o con rol no elegible da el **mismo 404**, para no revelar qué correos existen. |
| `DELETE /projects/:id/collaborators/:userId` | ADMINISTRATOR, RESEARCHER, STUDENT | Dueño / LEAD / admin. 204. |

Códigos: 400 validación (zod, `.strict()`: claves desconocidas como `ownerId`/`status` se rechazan), 401 sin/ inválido token, 403 sin permiso sobre un proyecto visible, 404 no visible/inexistente, 409 transición inválida / edición fuera de DRAFT / duplicado, 422 contenido insuficiente para enviar o rol no elegible como colaborador.

Orden de evaluación en endpoints de escritura: rol (403) → visibilidad (404) → permiso de gestión (403) → regla de negocio (409/422).

## Matriz de roles

| Acción | ADMIN | RESEARCHER dueño | RESEARCHER/STUDENT LEAD | RESEARCHER/STUDENT MEMBER | RESEARCHER/STUDENT ajeno | JUDGE | INVESTOR |
|---|---|---|---|---|---|---|---|
| Crear proyecto | si | si | - | - | si (RESEARCHER) / no (STUDENT) | no | no |
| Listar / ver | todos | propios + colaborados | idem | idem | solo lo suyo (404 el resto) | solo asignados | solo vinculados |
| Editar (DRAFT) | si (cualquier estado) | si | si | 403 | 404 | 403 | 403 |
| Enviar / retirar | si | si | si | 403 | 404 | 403 | 403 |
| Transiciones de evaluación | si | 403 | 403 | 403 | 404 | 403 | 403 |
| Ver colaboradores | si | si | si | si | 404 | 403 | 403 |
| Agregar / quitar colaboradores | si | si | si | 403 | 404 | 403 | 403 |

## Ciclo de vida (tabla única: `projects.lifecycle.ts`, `TRANSITIONS`)

| Desde | Hacia | Quién | Notas |
|---|---|---|---|
| DRAFT | SUBMITTED | dueño / LEAD / ADMIN | Requiere `title` y `description` no vacíos (si no, 422 con `missing`). Fija `submittedAt`. |
| SUBMITTED | DRAFT | dueño / LEAD / ADMIN | Retiro. Limpia `submittedAt`. |
| SUBMITTED | UNDER_EVALUATION | solo ADMIN | |
| UNDER_EVALUATION | EVALUATED | solo ADMIN | |
| EVALUATED | ARCHIVED | solo ADMIN | |

Cualquier otro par (incluido el mismo estado y salir de ARCHIVED) → **409** con `from`, `to` y `allowed`. Una transición válida sin permiso del actor → 403. El cambio es un compare-and-set (`UPDATE ... WHERE id AND status = <actual>`): dos transiciones concurrentes no pueden ganar ambas (la segunda recibe 409). La respuesta de proyecto incluye `allowedNextStatuses` para que el frontend pinte los botones.

## Alcance de lectura (patrón BR-007)

`visibleProjectsWhere(user)` en `projects.scope.ts` devuelve un fragmento `WHERE` de Prisma que se aplica con `AND` a **toda** consulta de proyecto (lista, conteo, detalle y las comprobaciones de escritura/colaboradores). Nada se filtra en JS.

| Rol | Cláusula |
|---|---|
| ADMINISTRATOR | `{}` |
| RESEARCHER, STUDENT | `ownerId = yo OR EXISTS collaborator(userId = yo)` |
| JUDGE | `EXISTS judgeAssignment(judgeId = yo)` |
| INVESTOR | `EXISTS investorProjectLink(investorId = yo)` |
| otro | no coincide con nada (deny por defecto) |

El futuro dashboard de inversionistas debe reutilizar esta función. Las pruebas ejercitan los 5 roles contra filas reales (con y sin vínculo/asignación/colaboración) y comprueban que quitar el vínculo revoca el acceso.

## Colaboradores

- Solo usuarios activos con rol RESEARCHER o STUDENT (otro rol → 422; inexistente/inactivo → 404).
- El dueño es LEAD implícito (sin fila en `project_collaborators`); agregarlo → 409; quitarlo → 409. Duplicado → 409.
- Un LEAD puede editar, enviar/retirar y gestionar colaboradores (también un STUDENT con rol LEAD). Un MEMBER solo lee.
- Quitar un colaborador revoca su acceso de lectura de inmediato (la visibilidad se calcula en cada consulta).

## Suposiciones a revisar

1. **Crear**: solo RESEARCHER y ADMINISTRATOR (STUDENT no crea).
2. **El ADMINISTRATOR puede editar en cualquier estado** (interpretación de "edits only while DRAFT ... ADMINISTRATOR always") y también enviar/retirar proyectos ajenos.
3. **Incompleto al enviar → 422** (no 409), para distinguirlo de una transición inválida. Mínimo: `title` + `description`.
4. **JUDGE e INVESTOR no ven la lista de colaboradores** (403) ni pueden editar; solo leen el proyecto. Los jueces ven `ownerId` en el proyecto (para el COI futuro); si la evaluación debe ser ciega, habrá que ocultarlo.
5. **Un INVESTOR vinculado puede ver el proyecto en cualquier estado, incluido DRAFT**; no se ocultan borradores. Probablemente convenga limitarlo a SUBMITTED o posterior cuando se construya el dashboard.
6. Añadir/quitar colaboradores se permite en cualquier estado (incluido ARCHIVED).
7. Retirar a DRAFT limpia `submittedAt`; reenviar lo vuelve a fijar.
8. No hay `DELETE /projects/:id` (no estaba en el alcance; ARCHIVED hace de baja lógica).
9. Paginación por `limit/offset` (no cursor), orden `createdAt desc, id desc`. `limit` mayor al tope se recorta a 100; `limit<1` o no numérico → 400.
10. Un 403 por rol (p. ej. JUDGE en `PUT`) no revela existencia; para roles permitidos, el proyecto no visible siempre es 404.
