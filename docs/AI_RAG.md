# IA / RAG: ingestión, embeddings y búsqueda vectorial (Semana 2)

Alcance de esta entrega: **extracción de texto + chunking** de los documentos subidos (FR-004, FR-027) y **generación de embeddings + almacenamiento vectorial** (AIR-002). El endpoint `/ask`, el prompt, las citas y la bitácora de interacciones (`ai_interaction_logs`, `retrieval_audit_logs`) quedan para la semana 3.

Código: `backend/src/ai/`. Pruebas: `backend/tests/ai-*.test.ts`.

## Arquitectura

```
POST /projects/:id/documents  (módulo documents)
   │  guarda bytes (FileStorage) + fila documents (PENDING) → commit
   └─ emitDocumentUploaded({documentId, projectId})        ← documents.events.ts
                │  (asíncrono, la petición HTTP no espera)
                ▼
      registerAiListeners()  →  ingestDocument(documentId)
                │
   PROCESSING → storage.read(storageKey)
              → extractText()        extract.ts   (PDF por página / DOCX / TXT / MD)
              → chunkSegments()      chunker.ts   (~900 car., solape 120, frases/párrafos)
              → embed() por lotes    embeddings/  (mock | openai-compatible)
              → UNA transacción: DELETE chunks viejos + INSERT nuevos + status READY
   cualquier error → status FAILED, 0 chunks, motivo corto en logs
```

| Archivo | Responsabilidad |
|---|---|
| `extract.ts` | bytes + mime/extensión → `{text, pageNumber}[]`. Verifica firma (`%PDF-`, `PK`), detecta binario disfrazado de texto, PDF cifrado, archivos sin texto. Quita NUL, sustitutos sueltos y caracteres de control (PostgreSQL rechaza `\u0000` en `TEXT`). |
| `chunker.ts` | Chunking determinista. Sin dependencias. |
| `embeddings/` | Interfaz `EmbeddingProvider`, proveedor `mock`, proveedor `openai` (compatible con la API de OpenAI vía `fetch`), fábrica por variable de entorno. |
| `ingestion.ts` | `ingestDocument(documentId)`; idempotente y serializado por documento. |
| `search.ts` | `searchChunks(projectId, queryEmbedding, k)`: base del `/ask` de la semana 3. |
| `vector.ts` | Serialización a literal pgvector (`[0.1,0.2,…]`, solo números validados). |
| `index.ts` | `registerAiListeners()` (el lead debe llamarlo en `server.ts`), `whenIngestionIdle()`. |

### Bibliotecas

- **PDF: `pdf-parse` 2.x** (envuelve `pdfjs-dist`). Publica build CommonJS (`require` → `dist/pdf-parse/cjs/index.cjs`), así que funciona con `module: commonjs`. Verificado bajo vitest, `tsx` y `tsc` + `node` plano. Entrega el texto **por página** (`getText().pages[].num`), de ahí `page_number`.
- **DOCX: `mammoth`** (`extractRawText`), CommonJS puro. DOCX no guarda números de página (es un formato de flujo), por lo que `page_number` es `NULL`.
- `jszip` solo como devDependency, para generar DOCX de prueba.

### Chunking

- Objetivo 900 caracteres, máximo duro 1000, solape 120 (≈225 / 250 / 30 tokens). `tokenCount` = `ceil(caracteres / 4)` (aproximación, no un tokenizador real).
- Unidades: párrafos (línea en blanco) → frases (`. ! ? …` seguidas de mayúscula, dígito, `¿`, `¡`, comillas); una frase más larga que el límite se parte en espacios; un "token" sin espacios más largo que el límite (URL, base64) se corta en seco sin partir pares sustitutos.
- Cada página PDF se trocea por separado: un chunk **nunca cruza páginas**, así `pageNumber` es exacto para las citas. El solape tampoco cruza páginas.
- El solape es un sufijo del chunk anterior que empieza en inicio de frase si es posible, o en límite de palabra.
- Se colapsan saltos de línea y espacios internos de un párrafo (los saltos de línea de un PDF suelen ser de maquetación); los párrafos se conservan como `\n\n`.

### Embeddings

`EmbeddingProvider { readonly dimensions: number; embed(texts: string[]): Promise<number[][]> }`. La dimensión **debe ser 1536** (columna `vector(1536)`); se valida el número y la longitud de cada vector en el proveedor y otra vez en `ingestion.ts`, y un valor distinto falla el documento con un mensaje claro.

- `mock` (por defecto): bolsa de palabras con hash FNV-1a (más bigramas) hacia 1536 dimensiones, normalizada L2, sin acentos ni mayúsculas. Determinista y sin red. Solo mide **coincidencia léxica** (no entiende sinónimos): sirve para desarrollo y pruebas, **no** para calidad real de recuperación.
- `openai`: `POST EMBEDDING_API_URL` con `{model, input[], encoding_format:'float'}` (y `dimensions:1536` si el modelo es `text-embedding-3-*`). Lotes de `EMBEDDING_BATCH_SIZE`, *timeout* por petición (`EMBEDDING_TIMEOUT_MS`), hasta 4 reintentos con espera exponencial (500 ms, 1 s, 2 s, 4 s; respeta `Retry-After`, tope 30 s) ante 429, 5xx, errores de red y *timeouts*. Otros 4xx (p. ej. 401) **no** se reintentan. La clave solo va en la cabecera `Authorization`; los mensajes de error no incluyen la clave, el cuerpo de la respuesta ni el texto embebido.

### Variables de entorno (`backend/src/config/env.ts`, `backend/.env.example`)

| Variable | Defecto | Notas |
|---|---|---|
| `EMBEDDING_PROVIDER` | `mock` | `mock` \| `openai`. |
| `EMBEDDING_API_KEY` | — | **Obligatoria** si `EMBEDDING_PROVIDER=openai`: el servidor no arranca sin ella (error claro al cargar la configuración). |
| `EMBEDDING_API_URL` | `https://api.openai.com/v1/embeddings` | Cualquier endpoint compatible. |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Debe producir 1536 dimensiones. |
| `EMBEDDING_BATCH_SIZE` | `64` | Textos por petición / por *slice* de ingestión. |
| `EMBEDDING_TIMEOUT_MS` | `30000` | Por petición. |

### Cómo cambiar a un proveedor real

1. En el entorno (Render → Environment, o `backend/.env` local): `EMBEDDING_PROVIDER=openai`, `EMBEDDING_API_KEY=<clave>`; opcional `EMBEDDING_MODEL` / `EMBEDDING_API_URL` para otro servicio compatible.
2. Reiniciar el backend. Los documentos ya ingeridos con `mock` **deben re-ingerirse** (los vectores de proveedores distintos no son comparables): basta llamar `ingestDocument(id)` para cada documento (reemplaza los chunks). No hay aún un comando/endpoint de reindexado masivo.
3. Un modelo con otra dimensión (p. ej. 3072) exige migración de `vector(1536)` + re-embeber todo (ver `docs/DATABASE.md`).

## Almacenamiento y consultas

- Los vectores se insertan con SQL parametrizado: `unnest($arrays)` + `t.vec::vector`, en lotes de 100 chunks por sentencia; nunca se concatena texto de usuario en SQL.
- `ingestDocument`: estado `PROCESSING`; al terminar, **una transacción** borra los chunks del documento, inserta los nuevos y pone `READY`. Si falla cualquier paso, se pone `FAILED` y se borran los chunks del documento (invariante: `FAILED` ⇒ sin chunks; nunca hay chunks parciales). Re-ejecutar reemplaza (idempotente). Dos ejecuciones del mismo documento se encolan en proceso. Los chunks pertenecen solo a su documento (FK `ON DELETE CASCADE`).
- `searchChunks(projectId, queryEmbedding, k≤100)`: `ORDER BY embedding_vector <=> $1::vector` (distancia coseno, coincide con `vector_cosine_ops` del índice HNSW), restringido en SQL a documentos del proyecto **y con estado `READY`**. Devuelve `similarity = 1 - distancia`. Con pgvector ≥ 0.8 activa `hnsw.iterative_scan = strict_order` dentro de la transacción para que el filtro por proyecto no devuelva menos de `k` resultados cuando hay muchos vectores de otros proyectos (si el servidor no soporta el parámetro, hace *fallback* a la consulta simple).
- Índice HNSW: con tablas pequeñas el planificador elige el plan exacto (filtro por proyecto → chunks → ordenar), que es correcto y rápido; con volumen, el HNSW. Las pruebas verifican con `EXPLAIN` + `SET LOCAL enable_seqscan = off` que la consulta de vecino más cercano usa `document_chunks_embedding_vector_hnsw_idx`, y que la consulta real de `searchChunks` puede ser servida por él (además de `enable_sort = off`, porque en una tabla diminuta el planificador prefiere el plan exacto).

## Fallos controlados (documento → `FAILED`, sin chunks, sin caída del proceso)

| Motivo en logs | Causa |
|---|---|
| `extraction:CORRUPT` | PDF/DOCX ilegible o truncado, firma incorrecta, binario como texto, `.doc` antiguo |
| `extraction:ENCRYPTED` | PDF protegido con contraseña |
| `extraction:EMPTY` | Archivo vacío o sin texto extraíble (PDF escaneado: **no hay OCR**) |
| `extraction:UNSUPPORTED_TYPE` | Extensión/MIME fuera de PDF, DOCX, TXT, MD |
| `extraction:TOO_LARGE` | Más de 3 000 000 de caracteres de texto |
| `storage:file_not_found` / `storage:error:<code>` | No se pudo leer el archivo |
| `embedding:<mensaje>` | Fallo del proveedor (401, 429 agotado, dimensión incorrecta…) |
| `error:<code>` | Error de base de datos u otro inesperado |

Los logs (`[ai] …`) solo llevan `documentId`, conteos y el motivo corto; nunca texto del documento, vectores ni claves. En `NODE_ENV=test` están silenciados salvo `AI_LOG=1`. `registerAiListeners()` envuelve cada ingestión en su propio `try/catch`: un fallo no tumba el proceso ni afecta la petición de subida.

## Integración pendiente para el lead

- Llamar `registerAiListeners()` en `backend/src/server.ts` (no en `app.ts`, para no disparar ingestión en cada importación de la app en las pruebas del resto). No se editó `server.ts` por indicación.
- El módulo `documents` debe emitir `emitDocumentUploaded` después del commit (contrato ya existente).

## Límites conocidos

- **Sin OCR**: PDF escaneados fallan con `EMPTY`.
- DOCX sin números de página; tablas/imágenes/encabezados/pies de DOCX no se tratan de forma especial (mammoth devuelve el texto plano). PDF con columnas múltiples o tablas puede salir con el orden de lectura de pdf.js.
- Chunks por página: una página con muy poco texto produce un chunk pequeño.
- El procesamiento es **en proceso** (event emitter): si el servidor se reinicia a mitad de una ingestión, el documento queda en `PROCESSING`/`PENDING`. No hay cola persistente ni *job* de recuperación (ver "Abierto").
- Render con disco efímero: si `UPLOAD_DIR` se pierde, un reintento fallará con `storage:file_not_found` (ver `docs/ROADMAP.md`).
- Memoria: los embeddings de un documento se mantienen como texto hasta la transacción (límite de 3 M caracteres ≈ 3 500 chunks ≈ 50–60 MB). Aceptable con `MAX_UPLOAD_MB=10`.
- El proveedor `mock` no tiene calidad semántica real.

## Supuestos a revisar

1. Tamaños de chunk (900/120/1000) y `tokenCount = chars/4` son elecciones razonables, no validadas contra el Design Document (no disponible) ni contra métricas de recuperación.
2. Solo se buscan documentos `READY` (mientras un documento se re-ingiere, sus chunks no aparecen).
3. Un chunk nunca cruza una página PDF, aunque la frase continúe en la siguiente.
4. Para `text-embedding-3-*` se envía `dimensions: 1536`; otros modelos compatibles deben devolver 1536 por sí mismos.
5. `EMBEDDING_PROVIDER` queda en `mock` por defecto **también en producción** (para no impedir el arranque en Render); en producción con `mock` se escribe una advertencia en logs. Conviene exigirlo explícitamente antes de la demo.
6. Límite de 3 M caracteres por documento.
7. pgvector en Render: se asume ≥ 0.7 (HNSW); `iterative_scan` requiere ≥ 0.8 (hay *fallback*). No se pudo verificar la versión de la instancia de Render (solo la local, 0.8.7).

## Pruebas

`backend/tests/ai-chunker.test.ts`, `ai-extract.test.ts`, `ai-embeddings.test.ts` (incluye comprobación de configuración al arranque), `ai-ingestion.test.ts` (extremo a extremo con BD local real, almacenamiento en directorio temporal y evento `uploaded`), `ai-search.test.ts` (búsqueda, filtro por proyecto, `EXPLAIN`). El proveedor `openai` se prueba **solo con `fetch` simulado**; no se ha ejecutado contra la API real. Ejecutar con una BD de pruebas local propia:

```bash
cd backend
TEST_DATABASE_URL="postgresql://urpmp:urpmp_dev_password@localhost:5544/urpmp_test_ai?schema=public" npx vitest run tests/ai-*.test.ts
```
