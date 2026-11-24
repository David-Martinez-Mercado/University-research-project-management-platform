// Loads sample data so the WHOLE flow can be tried by hand with the demo accounts (see seed-demo.ts):
// projects in every stage, collaborators with different permissions, documents (indexed for the AI assistant), milestones,
// a rubric, judge assignments, a saved evaluation draft, a finished evaluation, investor links, notifications and AI log rows.
//
//   npm run db:seed          # accounts + data
//   npm run db:seed-demo-data   # data only (accounts must already exist)
//
// Re-runnable: it first deletes the demo projects it created (matched by title and demo owner) and builds them again, so the
// scenarios always start from the same state. It never touches other users' projects. DEVELOPMENT ONLY.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type ProjectStatus } from '@prisma/client';
import { ingestDocument } from '../src/ai';
import { getStorage } from '../src/documents/storage';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const inDays = (days: number) => new Date(Date.now() + days * DAY);

// ───────────────────────── Documents (plain text so the assistant can quote them) ─────────────────────────

const DOCS = {
  ganadoPropuesta: `Propuesta: monitoreo de salud del ganado con sensores IoT

Objetivo general. Detectar de forma temprana enfermedades en el ganado bovino mediante sensores de temperatura corporal y actividad, reduciendo la mortalidad en los ranchos de Durango.

Metodología. Se colocan collares con sensores de temperatura y acelerómetro en 120 vacas. Los datos se envían cada cinco minutos a una plataforma en la nube. Un modelo de aprendizaje automático detecta fiebre y cambios de actividad con tres horas de anticipación frente a la revisión manual.

Resultados esperados. Reducir en 30 por ciento las pérdidas por enfermedades respiratorias y disminuir el uso de antibióticos mediante tratamientos más oportunos.

Presupuesto. El costo estimado por collar es de 450 pesos y la plataforma en la nube usa un plan gratuito durante el piloto.`,
  ganadoNotas: `Notas de laboratorio: calibración de sensores

Los sensores de temperatura se calibraron contra un termómetro clínico con un error máximo de 0.2 grados. La batería de los collares dura 45 días con envío cada cinco minutos. Se detectó pérdida de paquetes en zonas sin cobertura celular; se propone usar una antena LoRa en el corral central.`,
  aguaPropuesta: `Propuesta: calidad del agua en presas de Durango

Objetivo. Medir la concentración de nitratos y fosfatos en cinco presas del estado durante un ciclo agrícola completo para identificar las fuentes principales de contaminación.

Metodología. Se toman muestras quincenales en tres puntos por presa y se analizan en el laboratorio de la universidad. Los resultados se comparan con la norma oficial y se modelan con regresión para relacionarlos con la cercanía a zonas de cultivo.

Resultados esperados. Un mapa de riesgo por presa y recomendaciones para los productores sobre fertilización responsable.`,
  solarPropuesta: `Propuesta: energía solar en invernaderos

Objetivo. Evaluar si paneles solares semitransparentes sobre invernaderos de jitomate generan energía suficiente sin reducir el rendimiento del cultivo.

Metodología. Se comparan dos invernaderos idénticos, uno con paneles semitransparentes y otro de control. Se mide la radiación que llega a las plantas, el rendimiento por metro cuadrado y la energía generada cada día.

Resultados esperados. Cubrir al menos 60 por ciento del consumo eléctrico del invernadero con una pérdida de rendimiento menor al 5 por ciento.`,
  solarInforme: `Informe de avance: energía solar en invernaderos

En los primeros tres meses los paneles generaron en promedio 18 kilowatts hora por día. El rendimiento del jitomate bajo paneles fue 3 por ciento menor que en el invernadero de control, dentro del límite esperado. Falta medir el efecto en los meses de invierno.`,
  plagasPropuesta: `Propuesta: detección de plagas con visión por computadora

Objetivo. Identificar de forma automática la mosca blanca y el trips en hojas de chile a partir de fotografías tomadas con un teléfono.

Metodología. Se construye un conjunto de 4000 imágenes etiquetadas y se entrena una red convolucional ligera que corre en el propio teléfono, sin necesidad de conexión a internet.

Resultados. El modelo alcanzó 92 por ciento de precisión y 89 por ciento de exhaustividad en el conjunto de prueba, con un tiempo de respuesta de menos de un segundo por imagen.`,
} as const;

// ───────────────────────── helpers ─────────────────────────

async function mustFind(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Missing demo account ${email}. Run "npm run db:seed-demo" first.`);
  return user;
}

async function addDocument(projectId: string, uploadedById: string, fileName: string, text: string, type: 'PROPOSAL' | 'REPORT' | 'DATASET' | 'OTHER' = 'PROPOSAL') {
  const data = Buffer.from(text, 'utf8');
  const storageKey = `projects/${projectId}/${randomUUID()}`;
  await getStorage().save(storageKey, data);
  const doc = await prisma.document.create({
    data: { projectId, uploadedById, fileName, mimeType: 'text/plain', sizeBytes: data.length, type, storageKey, ingestionStatus: 'PENDING', uploadedAt: ago(5) },
  });
  const result = await ingestDocument(doc.id); // chunks + embeddings, so the AI assistant can answer from it
  if (result.status !== 'READY') console.warn(`   ! ${fileName}: ingestion ${result.status}`);
  return doc;
}

async function removeDemoProjects(titles: string[], ownerIds: string[]) {
  const old = await prisma.project.findMany({
    where: { title: { in: titles }, ownerId: { in: ownerIds } },
    include: { documents: { select: { storageKey: true } } },
  });
  for (const p of old) {
    for (const d of p.documents) await getStorage().remove(d.storageKey).catch(() => undefined);
  }
  // Retrieval audit rows reference chunks with ON DELETE RESTRICT: clear them (and the AI log) before the cascade.
  const ids = old.map((p) => p.id);
  await prisma.aiInteractionLog.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  return old.length;
}

const CRITERIA = [
  { name: 'Viabilidad técnica', description: '¿La metodología es realista con los recursos y el tiempo disponibles?', maxScore: 10, weight: 2, position: 0 },
  { name: 'Innovación', description: 'Novedad y aporte frente a lo que ya existe.', maxScore: 10, weight: 1.5, position: 1 },
  { name: 'Impacto esperado', description: 'Beneficio para la comunidad, el sector productivo o la ciencia.', maxScore: 10, weight: 1.5, position: 2 },
  { name: 'Claridad de la documentación', description: 'Calidad y orden de la propuesta y los informes.', maxScore: 10, weight: 1, position: 3 },
];

async function seedCriteria(adminId: string) {
  // Earlier manual tests may have left criteria with a broken accent: repair them instead of duplicating.
  const broken = await prisma.evaluationCriterion.findMany({ where: { name: { contains: '�' } } });
  for (const b of broken) {
    const fixed = CRITERIA.find((c) => c.name.slice(0, 6) === b.name.slice(0, 6));
    if (fixed) await prisma.evaluationCriterion.update({ where: { id: b.id }, data: { name: fixed.name } });
  }
  const result = [];
  for (const c of CRITERIA) {
    const existing = await prisma.evaluationCriterion.findFirst({ where: { name: c.name } });
    result.push(
      existing
        ? await prisma.evaluationCriterion.update({ where: { id: existing.id }, data: { ...c, isActive: true } })
        : await prisma.evaluationCriterion.create({ data: { ...c, createdById: adminId } }),
    );
  }
  return result;
}

async function notify(userId: string, projectId: string | null, type: 'PROJECT_STATUS' | 'JUDGE_ASSIGNED' | 'EVALUATION_SUBMITTED' | 'COLLABORATOR_ADDED' | 'SYSTEM', title: string, message: string, read = false) {
  await prisma.notification.create({
    data: { userId, projectId, type, title, message, isRead: read, readAt: read ? ago(1) : null, createdAt: ago(read ? 3 : 1) },
  });
}

// ───────────────────────── main ─────────────────────────

async function main() {
  const [admin, rosa, david, juez, inv] = await Promise.all(
    ['admin@demo.edu', 'rosa@demo.edu', 'colaborador@demo.edu', 'juez@demo.edu', 'inv@demo.edu'].map(mustFind),
  );

  const TITLES = {
    ganado: 'Monitoreo de salud del ganado con sensores IoT',
    agua: 'Calidad del agua en presas de Durango',
    solar: 'Energía solar en invernaderos',
    plagas: 'Detección de plagas con visión por computadora',
  };
  // The first manual test used a shorter title for the cattle project; replace it too.
  const removed = await removeDemoProjects([...Object.values(TITLES), 'Monitoreo de salud del ganado'], [rosa.id, david.id]);
  if (removed) console.log(`removed ${removed} previous demo project(s)`);

  const criteria = await seedCriteria(admin.id);
  console.log(`rubric   ${criteria.length} criteria`);

  // Notifications of the demo accounts start clean so the counters match this story.
  await prisma.notification.deleteMany({ where: { userId: { in: [admin.id, rosa.id, david.id, juez.id, inv.id] } } });

  // 1) DRAFT — Rosa owns it; David is an EDITOR. Try: edit, upload, milestones, ask the AI, submit (owner only).
  const ganado = await prisma.project.create({
    data: {
      ownerId: rosa.id,
      title: TITLES.ganado,
      summary: 'Collares con sensores para detectar enfermedades del ganado antes de que sean visibles.',
      description: 'Piloto en 120 vacas de ranchos de Durango con sensores de temperatura y actividad y un modelo de aprendizaje automático.',
      researchArea: 'Veterinaria',
      affiliation: 'UNIPOLI Durango',
      status: 'DRAFT',
      createdAt: ago(20),
    },
  });
  await prisma.projectCollaborator.create({ data: { projectId: ganado.id, userId: david.id, role: 'EDITOR' } });
  await addDocument(ganado.id, rosa.id, 'propuesta-ganado.txt', DOCS.ganadoPropuesta);
  await addDocument(ganado.id, david.id, 'notas-calibracion.txt', DOCS.ganadoNotas, 'REPORT');
  await prisma.milestone.createMany({
    data: [
      { projectId: ganado.id, title: 'Revisión de literatura', dueDate: ago(10), completedAt: ago(9), createdById: rosa.id },
      { projectId: ganado.id, title: 'Calibración de sensores', dueDate: ago(2), completedAt: ago(1), createdById: david.id },
      { projectId: ganado.id, title: 'Piloto en el rancho', dueDate: inDays(20), createdById: rosa.id },
      { projectId: ganado.id, title: 'Análisis de resultados', dueDate: inDays(45), createdById: rosa.id },
    ],
  });

  // 2) SUBMITTED — Rosa owns it; David is VIEWER (read-only). Try: admin assigns a judge, then starts the evaluation.
  const agua = await prisma.project.create({
    data: {
      ownerId: rosa.id,
      title: TITLES.agua,
      summary: 'Mapa de riesgo por contaminación de nitratos y fosfatos en cinco presas.',
      description: 'Muestreo quincenal durante un ciclo agrícola, análisis de laboratorio y modelo de regresión.',
      researchArea: 'Medio ambiente',
      affiliation: 'UNIPOLI Durango',
      status: 'SUBMITTED',
      submittedAt: ago(2),
      createdAt: ago(15),
    },
  });
  await prisma.projectCollaborator.create({ data: { projectId: agua.id, userId: david.id, role: 'VIEWER' } });
  await addDocument(agua.id, rosa.id, 'propuesta-agua.txt', DOCS.aguaPropuesta);
  await prisma.milestone.createMany({
    data: [
      { projectId: agua.id, title: 'Selección de presas', completedAt: ago(10), createdById: rosa.id },
      { projectId: agua.id, title: 'Primer muestreo', dueDate: inDays(7), createdById: rosa.id },
    ],
  });

  // 3) UNDER_EVALUATION — David owns it, Rosa is an EDITOR; the judge has a SAVED DRAFT. Try: judge resumes, submits → project closes.
  const solar = await prisma.project.create({
    data: {
      ownerId: david.id,
      title: TITLES.solar,
      summary: 'Paneles semitransparentes sobre invernaderos de jitomate.',
      description: 'Comparación de un invernadero con paneles y uno de control: energía generada frente a rendimiento del cultivo.',
      researchArea: 'Energías renovables',
      affiliation: 'UNIPOLI Durango',
      status: 'UNDER_EVALUATION',
      submittedAt: ago(12),
      createdAt: ago(40),
    },
  });
  await prisma.projectCollaborator.create({ data: { projectId: solar.id, userId: rosa.id, role: 'EDITOR' } });
  await addDocument(solar.id, david.id, 'propuesta-solar.txt', DOCS.solarPropuesta);
  await addDocument(solar.id, rosa.id, 'informe-avance.txt', DOCS.solarInforme, 'REPORT');
  await prisma.milestone.createMany({
    data: [
      { projectId: solar.id, title: 'Instalación de paneles', completedAt: ago(30), createdById: david.id },
      { projectId: solar.id, title: 'Medición de verano', completedAt: ago(15), createdById: david.id },
      { projectId: solar.id, title: 'Medición de invierno', dueDate: inDays(60), createdById: david.id },
    ],
  });
  const solarAssignment = await prisma.judgeAssignment.create({
    data: { projectId: solar.id, judgeId: juez.id, assignedById: admin.id, status: 'IN_PROGRESS', assignedAt: ago(8) },
  });
  await prisma.evaluation.createMany({
    data: [
      { assignmentId: solarAssignment.id, criterionId: criteria[0]!.id, score: 8, comments: 'Metodología sólida; falta medir el invierno.', status: 'DRAFT' },
      { assignmentId: solarAssignment.id, criterionId: criteria[1]!.id, score: 7, comments: null, status: 'DRAFT' },
    ],
  });

  // 4) EVALUATED — Rosa owns it; fully evaluated. Try: results, investor dashboard and PDF report.
  const plagas = await prisma.project.create({
    data: {
      ownerId: rosa.id,
      title: TITLES.plagas,
      summary: 'Red convolucional ligera que identifica mosca blanca y trips desde el teléfono.',
      description: 'Conjunto de 4000 imágenes etiquetadas y un modelo que funciona sin conexión a internet.',
      researchArea: 'Inteligencia artificial',
      affiliation: 'UNIPOLI Durango',
      status: 'EVALUATED',
      submittedAt: ago(40),
      createdAt: ago(70),
    },
  });
  await addDocument(plagas.id, rosa.id, 'propuesta-plagas.txt', DOCS.plagasPropuesta);
  await prisma.milestone.createMany({
    data: [
      { projectId: plagas.id, title: 'Etiquetado de imágenes', completedAt: ago(60), createdById: rosa.id },
      { projectId: plagas.id, title: 'Entrenamiento del modelo', completedAt: ago(45), createdById: rosa.id },
      { projectId: plagas.id, title: 'Prueba en campo', completedAt: ago(35), createdById: rosa.id },
    ],
  });
  const plagasAssignment = await prisma.judgeAssignment.create({
    data: { projectId: plagas.id, judgeId: juez.id, assignedById: admin.id, status: 'COMPLETED', assignedAt: ago(30), completedAt: ago(20) },
  });
  const finalScores = [
    [9, 'Excelente viabilidad: el modelo corre en el teléfono.'],
    [8, 'Aporta un conjunto de datos propio.'],
    [9, 'Útil para pequeños productores sin internet.'],
    [7, 'Faltan más detalles del protocolo de etiquetado.'],
  ] as const;
  await prisma.evaluation.createMany({
    data: criteria.map((c, i) => ({
      assignmentId: plagasAssignment.id,
      criterionId: c.id,
      score: finalScores[i]![0],
      comments: finalScores[i]![1],
      status: 'SUBMITTED' as const,
      submittedAt: ago(20),
    })),
  });

  // Investor ("revisor de avances") sees the two most advanced projects.
  await prisma.investorProjectLink.createMany({
    data: [solar.id, plagas.id].map((projectId) => ({ investorId: inv.id, projectId, linkedById: admin.id })),
  });

  // AI log rows for the admin's review screen (one reported as incorrect).
  const ganadoChunk = await prisma.documentChunk.findFirst({ where: { document: { projectId: ganado.id } } });
  const flaggedAnswer = await prisma.aiInteractionLog.create({
    data: {
      userId: rosa.id,
      projectId: ganado.id,
      prompt: '¿Cuántas vacas participan en el piloto?',
      response: 'Según los documentos del proyecto: «Se colocan collares con sensores de temperatura y acelerómetro en 120 vacas.»',
      model: 'mock-extractive',
      confidence: 0.71,
      latencyMs: 180,
      flagged: true,
      flaggedAt: ago(1),
      createdAt: ago(2),
    },
  });
  if (ganadoChunk) {
    await prisma.retrievalAuditLog.create({ data: { interactionId: flaggedAnswer.id, chunkId: ganadoChunk.id, similarityScore: 0.71, rank: 1 } });
  }
  await prisma.aiInteractionLog.create({
    data: {
      userId: david.id,
      projectId: ganado.id,
      prompt: '¿Quién gana el mundial?',
      response: 'No se encontró información suficientemente relevante en los documentos del proyecto.',
      confidence: 0.02,
      fallback: true,
      latencyMs: 90,
      createdAt: ago(1),
    },
  });

  // Notifications so every role's bell has something to show.
  await notify(admin.id, agua.id, 'PROJECT_STATUS', 'Proyecto enviado', `«${TITLES.agua}» fue enviado para evaluación. Asigna jueces desde el panel.`);
  await notify(admin.id, solar.id, 'EVALUATION_SUBMITTED', 'Evaluación en curso', 'El juez guardó un borrador de su evaluación.', true);
  await notify(rosa.id, solar.id, 'COLLABORATOR_ADDED', 'Te agregaron a un proyecto', `Ahora colaboras en «${TITLES.solar}».`);
  await notify(rosa.id, plagas.id, 'PROJECT_STATUS', 'Evaluación finalizada', `«${TITLES.plagas}» fue evaluado. Ya puedes consultar los resultados.`);
  await notify(david.id, ganado.id, 'COLLABORATOR_ADDED', 'Te agregaron a un proyecto', `Ahora colaboras en «${TITLES.ganado}».`, true);
  await notify(david.id, agua.id, 'COLLABORATOR_ADDED', 'Te agregaron a un proyecto', `Ahora colaboras en «${TITLES.agua}» con permiso de solo lectura.`);
  await notify(juez.id, solar.id, 'JUDGE_ASSIGNED', 'Nuevo proyecto asignado', `Se te asignó «${TITLES.solar}» para evaluar.`, true);
  await notify(juez.id, solar.id, 'PROJECT_STATUS', 'Ya puedes evaluar', `«${TITLES.solar}» está en evaluación. Retoma tu borrador.`);
  await notify(inv.id, solar.id, 'SYSTEM', 'Nuevo proyecto vinculado', `Ahora puedes consultar el avance de «${TITLES.solar}».`);
  await notify(inv.id, plagas.id, 'SYSTEM', 'Nuevo proyecto vinculado', `Ahora puedes consultar el avance de «${TITLES.plagas}».`);

  const status = (s: ProjectStatus) => s.padEnd(16);
  console.log('\nProyectos de demostración:');
  for (const [p, who] of [
    [ganado, 'dueña Rosa · colaborador David (edita)'],
    [agua, 'dueña Rosa · colaborador David (solo lectura)'],
    [solar, 'dueño David · colaboradora Rosa (edita) · juez con borrador'],
    [plagas, 'dueña Rosa · evaluado · inversionista vinculado'],
  ] as const) {
    console.log(`  ${status(p.status)} ${p.title}\n                   ${who}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
