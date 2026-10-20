# Documentos, asignación de jueces (COI), criterios y rúbrica (Semana 2)

Implementado por el agente `business-backend`. Código en `backend/src/{documents,judging,criteria}/` (más `GET /users` en `backend/src/users/`). Pruebas en `backend/tests/{documents,judging,criteria,users}.test.ts`. Sin cambios de esquema ni migraciones.

Siguen **abiertos**: flujo de evaluación con recuperación de borrador (FR-029, `/evaluations`), vínculos y dashboard de inversionista + reporte (BR-007, `/investor-links`, `/investors/:id/dashboard`, `/projects/:id/report`) y notificaciones (`/notifications`). Ver el final.

Todos los endpoints pasan por `authorize(...)` (401 sin token válido, 403 por rol). Orden de evaluación: rol (403) → visibilidad del proyecto (404) → regla de negocio (409/422).

## Endpoints

### Documentos (`backend/src/documents/`)

| Método y ruta | Roles (puerta de rol) | Regla adicional |
|---|---|---|
| `POST /projects/:id/documents` | ADMINISTRATOR, RESEARCHER, STUDENT | Proyecto visible (si no, 404): dueño, colaborador (LEAD o MEMBER) o admin. Solo con el proyecto en `DRAFT` o `SUBMITTED` (si no, 409, también para el admin). |
| `GET /projects/:id/documents` | ADMINISTRATOR, RESEARCHER, STUDENT, JUDGE | Proyecto visible (equipo, admin, juez asignado). INVESTOR → 403 siempre. |
| `GET /projects/:id/documents/:docId/download` | ídem | Ídem. `docId` debe pertenecer a `:id` (si no, 404). |

`POST` es `multipart/form-data`: campo `file` (uno solo) y campo de texto opcional `type` (`PROPOSAL`, `REPORT`, `DATASET`, `PUBLICATION`, `OTHER`; por defecto `OTHER`). Cualquier otro campo → 400. Respuesta 201 (objeto) / lista `{data:[...]}`:

```json
{ "id": "...", "projectId": "...", "fileName": "propuesta.pdf", "mimeType": "application/pdf",
  "sizeBytes": 12345, "type": "PROPOSAL", "ingestionStatus": "PENDING",
  "uploadedAt": "...", "uploadedBy": { "id": "...", "fullName": "..." } }
```

`storageKey` nunca se expone. La descarga responde con `Content-Disposition: attachment` (nombre ASCII de respaldo + `filename*=UTF-8''...`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y `Content-Length`. Si los bytes ya no están en el almacenamiento (disco efímero de Render) → 404.

### Asignación de jueces (`backend/src/judging/`)

| Método y ruta | Roles | Descripción |
|---|---|---|
| `POST /judge-assignments` | ADMINISTRATOR | Body `{projectId, judgeId}` (estricto). 201 con la asignación (`judge`, `project` resumidos). |
| `GET /judge-assignments?projectId=&limit=&offset=` | ADMINISTRATOR | `{data,total,limit,offset}`; `projectId` opcional. |
| `DELETE /judge-assignments/:id` | ADMINISTRATOR | 204. 409 si ya existen evaluaciones (se bloquea la fila y se cuenta en la misma transacción). |
| `GET /judges/:id/projects` | ADMINISTRATOR, o el propio JUDGE | Proyectos asignados al juez `:id` (usa `visibleProjectsWhere`, ver abajo). Incluye `assignment` por proyecto. Otro juez → 403; `:id` que no es un juez → 404. |

### Criterios y rúbrica (`backend/src/criteria/`)

| Método y ruta | Roles | Descripción |
|---|---|---|
| `GET /criteria` | ADMINISTRATOR, JUDGE | `{data:[...]}` solo activos, ordenados por `position`, luego fecha de creación. `?includeInactive=true` solo lo respeta el admin (para el juez se ignora). |
| `POST /criteria` | ADMINISTRATOR | `name` (1–200), `description?`, `maxScore` entero 1–100 (def. 10), `weight` 0.01–99.99 con máx. 2 decimales (def. 1), `position` entero >= 0 (def. 0), `isActive` (def. true). Estricto. |
| `PUT /criteria/:id` | ADMINISTRATOR | Parcial, estricto. Desactivar = `{isActive:false}`. **No existe DELETE** (los criterios referenciados por evaluaciones deben sobrevivir). |
| `GET /projects/:id/rubric` | ADMINISTRATOR, RESEARCHER, STUDENT, JUDGE | `{projectId, data:[criterios activos ordenados]}` de un proyecto visible. INVESTOR → 403; no visible → 404. |

### Usuarios (admin)

`GET /users` (solo ADMINISTRATOR): query `role`, `q` (subcadena sin distinguir mayúsculas en email o nombre; los comodines `%` y `_` se tratan literalmente), `limit` (def. 20, tope 100), `offset`. Respuesta `{data,total,limit,offset}` con `toPublicUser` (sin hash ni datos de bloqueo). Orden `createdAt desc, id desc`.

## Matriz de roles

| Acción | ADMIN | Dueño / colaborador | RESEARCHER/STUDENT ajeno | JUDGE asignado | JUDGE no asignado | INVESTOR |
|---|---|---|---|---|---|---|
| Subir documento (DRAFT/SUBMITTED) | si | si | 404 | 403 | 403 | 403 |
| Listar / descargar documentos | si | si | 404 | si | 404 | 403 |
| Ver rúbrica del proyecto | si | si | 404 | si | 404 | 403 |
| `POST/GET/DELETE /judge-assignments` | si | 403 | 403 | 403 | 403 | 403 |
| `GET /judges/:id/projects` | cualquier juez | 403 | 403 | solo el suyo | 403 (otro id) | 403 |
| `GET /criteria` | si (+ inactivos) | 403 | 403 | si (solo activos) | si (solo activos) | 403 |
| `POST/PUT /criteria` | si | 403 | 403 | 403 | 403 | 403 |
| `GET /users` | si | 403 | 403 | 403 | 403 | 403 |

## Validación de archivos (carga)

Todo se valida **antes** de guardar nada; si falla, no hay fila, no hay bytes y no hay evento.

| Regla | Resultado |
|---|---|
| Tamaño máximo `MAX_UPLOAD_MB` (límite de multer, se lee en cada petición) | 413 |
| Sin archivo, campo con otro nombre, más de un archivo, multipart mal formado o truncado, campo `type` inválido o campos extra | 400 |
| Archivo vacío | 400 |
| Extensión permitida: `pdf`, `docx`, `txt`, `md` (si no, o sin extensión) | 415 |
| **Contenido** coherente con la extensión: PDF empieza con `%PDF-`; DOCX es ZIP (`PK\x03\x04`) con directorio central válido que contiene `[Content_Types].xml` y `word/document.xml`; TXT/MD son UTF-8 válido sin bytes NUL | 415 |

Notas:

- El `Content-Type` que declara el cliente **se ignora**. El `mimeType` guardado se deriva de la extensión ya validada (`application/pdf`, el MIME de DOCX, `text/plain`, `text/markdown`).
- Defensa anti zip-bomb: el DOCX se inspecciona leyendo solo el directorio central (no se descomprime nada); se rechaza si declara más de 10 000 entradas, ZIP64 o más de 200 MB descomprimidos.
- **Nombre de archivo**: se descartan directorios (`/` y `\`), caracteres de control, de formato (bidi, ancho cero) y separadores de línea; `< > : " | ? *` pasan a `_`; se colapsan espacios, se quitan puntos iniciales/finales y se limita a 200 caracteres conservando la extensión. El nombre es solo de visualización: **nunca** forma parte de la ruta de almacenamiento. Un byte NUL o control crudo en la cabecera lo rechaza el parser multipart (400).
- **Clave de almacenamiento**: la genera el servidor, `projects/<projectId>/<uuid>`, mediante `FileStorage` (`getStorage()`).
- Orden: validar → guardar bytes → insertar fila (transacción con `SELECT ... FOR SHARE` sobre el proyecto, para que un cambio de estado concurrente espere y no se cuele un documento en un proyecto que ya salió de DRAFT/SUBMITTED) → `emitDocumentUploaded({documentId, projectId})`. Si la inserción falla se borran los bytes. Si un oyente del evento lanza una excepción, se registra y la carga sigue siendo 201.
- Antes de leer el cuerpo se hace una comprobación barata (404/409) para que quien no puede subir no obligue al servidor a bufferizar el archivo; se repite dentro de la transacción.
- `ingestionStatus` nace en `PENDING`; solo el agente de IA lo cambia.

## Conflicto de interés (FR-010)

Función pura en `judging.coi.ts` (`evaluateConflictOfInterest`), evaluada **dentro de la transacción** de `POST /judge-assignments`. Un conflicto **rechaza** la asignación con **422**; no existe modo "advertir y permitir".

Hay conflicto si:

1. el juez es el **dueño** del proyecto (`JUDGE_IS_OWNER`), o
2. el juez es **colaborador** (LEAD o MEMBER) del proyecto (`JUDGE_IS_COLLABORATOR`), o
3. `judge.affiliation` == `project.affiliation` (`SAME_AFFILIATION`), comparando sin distinguir mayúsculas, espacios ni acentos (NFKD, sin marcas diacríticas, espacios colapsados).

**Falla cerrado**: si falta la afiliación del juez o la del proyecto (nula, vacía o solo espacios), la asignación también se rechaza (422, `code: "AFFILIATION_REQUIRED"`) con un mensaje que indica que hay que completarla (`PUT /users/:id` o `PUT /projects/:id`).

Cuerpo del 422: `{ error, code: "CONFLICT_OF_INTEREST" | "AFFILIATION_REQUIRED", reasons: [{code, message}] }` (todas las razones a la vez).

Concurrencia: la transacción bloquea la fila del proyecto (`FOR UPDATE`) y la del juez (`FOR NO KEY UPDATE`, en ese orden). Un alta de colaborador, cambio de afiliación o de estado que esté en vuelo o bien se confirma antes (y la verificación lo ve) o espera a que termine la asignación. Dos asignaciones idénticas simultáneas: una gana (201) y la otra recibe 409 (índice único `projectId+judgeId`). Hay pruebas de ambos casos.

Otras reglas de `POST /judge-assignments`: el usuario debe existir (404), tener rol JUDGE y estar activo (422); el proyecto debe existir (404) y estar en `SUBMITTED` o `UNDER_EVALUATION` (409); duplicado → 409.

## Alcance de lectura de jueces

`GET /judges/:id/projects` aplica `visibleProjectsWhere({id: :id, role: 'JUDGE'})` **y** `visibleProjectsWhere(quien llama)` con `AND` en la consulta de Prisma. Un juez que pide su propio id obtiene el mismo fragmento dos veces; el admin obtiene el del juez objetivo. Un juez nunca puede resolver filas de otro.

## Suposiciones a revisar

1. **Solo se comparan `judge.affiliation` y `project.affiliation`** (más dueño y colaboradores por id). No se compara la afiliación del juez con la de los colaboradores/dueño del proyecto. Como `Project.affiliation` se copia de la del creador al crear (pero es editable), un proyecto cuya afiliación se editó puede no coincidir con la del dueño. Si se quiere un COI más estricto, es una línea en `evaluateConflictOfInterest`.
2. Quitar acentos al comparar afiliaciones solo puede **añadir** coincidencias (sentido seguro). No hay normalización de siglas ("UPD" vs "Universidad Politécnica de Durango"): eso requiere una lista controlada de instituciones.
3. La verificación solo corre al asignar. Si una afiliación cambia o el juez se vuelve colaborador **después** de la asignación, esta no se revoca automáticamente.
4. Estado del proyecto inválido para asignar → 409 (conflicto de estado); rol/actividad del juez, COI y afiliación faltante → 422.
5. El admin también tiene el bloqueo de subida por estado (solo DRAFT/SUBMITTED), a diferencia de la edición de proyecto, donde el admin puede editar siempre.
6. Los INVESTOR no pueden listar ni descargar documentos ni ver la rúbrica, aunque estén vinculados. Un JUDGE asignado sí ve documentos en cualquier estado del proyecto.
7. El `type` de documento y los campos extra del formulario son estrictos (400), de modo que el frontend debe enviar solo `file` y `type`.
8. `includeInactive=true` enviado por un JUDGE se **ignora** (no es 403).
9. Cambiar `maxScore` de un criterio que ya tiene evaluaciones **no** se bloquea hoy; la evaluación (Semana 3) deberá decidir si congela el valor o guarda una copia por evaluación.
10. `GET /judge-assignments` y `GET /judges/:id/projects` usan paginación `limit/offset` (def. 20, tope 100) como `/projects`; `GET /projects/:id/documents` y `GET /criteria` devuelven la lista completa (`{data}`).
11. El almacenamiento es disco local (`UPLOAD_DIR`), efímero en Render; la API de `FileStorage` permite cambiarlo sin tocar este módulo. `FileStorage.read` devuelve un `Buffer`, así que la descarga carga el archivo en memoria (tope `MAX_UPLOAD_MB`) en lugar de hacer *streaming* real.
12. No hay antivirus ni análisis de macros; el contenido solo se valida estructuralmente.
13. `GET /users` no tiene filtro `isActive`; el selector de jueces del frontend filtra con `role=JUDGE` y debe ocultar los inactivos o pedir ese filtro después.

## Pendiente (no incluido en este sprint)

| Elemento | Estado |
|---|---|
| Evaluación con recuperación de borrador (FR-029) | **Abierto** (Semana 3). La tabla `evaluations` y la rúbrica ya existen. |
| Dashboard de inversionista, `/investor-links`, `/projects/:id/report` (BR-007) | **Abierto** (Semana 3). `visibleProjectsWhere` ya cubre al INVESTOR por vínculos. |
| Notificaciones in-app (`/notifications`) | **Abierto** (Semana 3). Ni la asignación ni la carga generan notificaciones todavía. |
