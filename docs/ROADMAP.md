# Cronograma por semanas — University Research Project Management Platform

**Fuente:** fichas del tablero de Notion (leídas el 20 oct 2026). Las fechas de Notion están marcadas como *estimadas, por validar*; este cronograma las respeta como fechas límite y reparte las actividades en semanas (lunes a domingo), cada una con un entregable que se pueda verificar.

| Ficha de Notion | Ventana | Responsable propuesto en Notion |
|---|---|---|
| Base de datos — Modelado y configuración | 8–14 oct | Responsable de BD |
| Backend — Auth & RBAC y núcleo de API | 8–21 oct | Responsable de backend |
| Frontend — Interfaces por rol | 8 oct–18 nov | Responsable de frontend |
| Backend — Módulos de negocio | 15 oct–11 nov | Responsable de backend |
| IA/RAG — Pipeline, embeddings y asistente | 22 oct–11 nov | Responsable de IA |
| Pruebas (Testing) | 12–25 nov | Responsable de QA |
| Despliegue y entrega final | 26 nov–2 dic | Equipo completo |

*(Las filas "Formación del equipo", "Planificación trimestral de ventas" y "Compilación en Movil" del tablero son datos de ejemplo de la plantilla; no forman parte del proyecto.)*

---

## Semana 1 · 12–18 oct — Cimientos ✅ COMPLETADA

| Actividad | Ficha |
|---|---|
| 12 entidades, migraciones, índice HNSW, `.env.example`, prueba de humo | Base de datos |
| Login, bootstrap-owner, JWT por inactividad, RBAC, bloqueo de cuenta, `/users` | Auth |
| Modelo de Proyecto, ciclo de estados, CRUD `/projects`, colaboradores | Negocio |
| Scaffolding Vite/React/TS/Tailwind, librería de componentes, Login | Frontend |

**Entregable:** un administrador entra con su cuenta, el backend protege sus rutas por rol y la BD vive en Render. *Verificado: 82 pruebas de backend, 22 de frontend.*

---

## Semana 2 · 19–25 oct — Documentos, jueces e ingestión de IA ✅ COMPLETADA (20 oct)

| Actividad | Ficha | Requisito |
|---|---|---|
| Carga de documentos con validación de tipo y tamaño (`POST/GET /projects/:id/documents`) | Negocio | — |
| Asignación de jueces con verificación de conflicto de interés (`/judge-assignments`, `/judges/:id/projects`) | Negocio | FR-010 |
| Criterios de evaluación y rúbrica (`/criteria`, `/projects/:id/rubric`) | Negocio (Admin) | — |
| Extracción de texto y *chunking* de documentos subidos | IA/RAG | FR-004, FR-027 |
| Generación de embeddings y almacenamiento en pgvector | IA/RAG | AIR-002 |
| Dashboards adaptados por rol + workspace del proyecto (Overview, Documentos, Colaboradores) | Frontend | — |

**Entregable:** un investigador crea un proyecto, sube un documento y queda indexado en pgvector; un administrador asigna un juez y el sistema **rechaza** la asignación si hay conflicto de interés; cada rol ve su propio dashboard.

**Verificado el 20 oct:** 304 pruebas de backend (por archivo) y 93 de frontend; prueba de punta a punta con servidor real: subida → `READY` con 1 fragmento de 1536 dimensiones; asignación con misma afiliación → 422, con otra afiliación → 201; 63 comprobaciones de navegador del agente de frontend. *Limitaciones:* embeddings simulados (sin llave de proveedor), almacenamiento en disco local, y sin revisión manual con lector de pantalla o teléfono real.

---

## Semana 3 · 26 oct–1 nov — Evaluación, inversionistas y primera pregunta a la IA

| Actividad | Ficha | Requisito |
|---|---|---|
| Flujo de evaluación con recuperación de borrador (`/evaluations`) | Negocio | FR-029 |
| Vínculos y dashboard de inversionista, reporte del proyecto (`/investor-links`, `/investors/:id/dashboard`, `/projects/:id/report`) | Negocio | BR-007 |
| Notificaciones in-app (`/notifications`) | Negocio | — |
| `POST /projects/:id/ask` con verificación de confianza y *fallback* | IA/RAG | AIR-004, FR-008 |
| Pantalla de Evaluación (Juez) y Dashboard de Inversionista | Frontend | — |

**Entregable:** un juez evalúa un proyecto, cierra el navegador y recupera su borrador; un inversionista ve **solo** los proyectos vinculados; se puede preguntar a la IA sobre un proyecto y responde con citas o con el *fallback*.

---

## Semana 4 · 2–8 nov — Asistente de IA completo y panel de administración

| Actividad | Ficha | Requisito |
|---|---|---|
| Etiqueta "generado por IA" y botón "Reportar respuesta incorrecta" | IA/RAG + Frontend | AIR-007, AIR-009 |
| Registro de interacciones con retención de 12 meses | IA/RAG | AIR-005, AIR-008 |
| Conjunto de prueba manual para validar calidad de respuestas | IA/RAG | AIR-001 |
| Pestañas Asistente IA y Progreso del workspace | Frontend | — |
| Panel de Administración (usuarios, criterios, asignaciones) | Frontend | — |

**Entregable:** el flujo completo de IA de punta a punta (pregunta → respuesta citada → reporte), y un administrador gestiona usuarios, criterios y jueces desde la interfaz.

---

## Semana 5 · 9–15 nov — Cierre de backend/IA e inicio de pruebas

| Actividad | Ficha | Fecha límite |
|---|---|---|
| Cierre y endurecimiento de Negocio e IA/RAG | Negocio, IA/RAG | **11 nov** |
| Pruebas unitarias/integración | Pruebas | desde 12 nov |
| Matriz de control de acceso por rol | Pruebas | NFR-003, NFR-011 |
| Simulación de bloqueo de cuenta y expiración de sesión | Pruebas | NFR-013, NFR-012 |

**Entregable:** fichas de Negocio e IA/RAG en *Done*; matriz de acceso por rol ejecutada con resultados.

---

## Semana 6 · 16–22 nov — Usabilidad y accesibilidad

| Actividad | Ficha | Requisito |
|---|---|---|
| Cierre del frontend | Frontend | **18 nov** |
| Revisión de accesibilidad WCAG 2.1 AA en pantallas clave | Pruebas | NFR-009 |
| Prueba de usabilidad (encuesta SUS, meta ≥ 70) | Pruebas | NFR-001 |
| Verificación de los 7 riesgos técnicos del Documento de Diseño | Pruebas | TR-01 a TR-07 |

**Entregable:** informe de accesibilidad y resultados de la encuesta SUS. *La encuesta requiere personas reales; se prepara el instrumento pero alguien debe aplicarla.*

---

## Semana 7 · 23–29 nov — Cierre de pruebas y despliegue

| Actividad | Ficha | Fecha límite |
|---|---|---|
| Cierre de Pruebas | Pruebas | **25 nov** |
| Despliegue en Render (Web Service + Static Site + PostgreSQL) | Despliegue | desde 26 nov |
| Monitoreo/uptime durante la ventana de evaluación | Despliegue | NFR-005 |

**Entregable:** la aplicación funcionando en una URL pública de Render, con monitoreo activo.

---

## Semana 8 · 30 nov–2 dic — Entrega final

| Actividad | Ficha | Fecha límite |
|---|---|---|
| Empaquetado de documentación final (Charter, SRS, Auditoría QA, Documento de Diseño) | Despliegue | **2 dic** |
| Demo final | Despliegue | **2 dic** |

**Entregable:** paquete de documentación + demo en vivo.

---

## Riesgos y supuestos

- Las fechas de Notion son estimadas; si la fecha real de entrega del curso cambia, se recorren las semanas 7–8.
- IA/RAG necesita una API de embeddings y otra de LLM. Hasta contar con las llaves, el pipeline se construye con una interfaz de proveedor y un proveedor simulado para pruebas.
- Los archivos subidos se guardan hoy en disco local (interfaz `FileStorage`). El disco de un Web Service de Render es efímero: antes de desplegar hay que pasar a un disco persistente o a almacenamiento de objetos.
