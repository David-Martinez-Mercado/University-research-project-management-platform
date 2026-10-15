// Smoke test: inserts one row per entity, runs a multi-table JOIN, and confirms the
// HNSW index is used for similarity search. Everything runs in a transaction that is
// rolled back, so the database is left untouched.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
class Rollback extends Error {}

const DIM = 1536;
const vec = (seed: number) => `[${Array.from({ length: DIM }, (_, i) => Math.sin(seed + i)).join(',')}]`;

async function main() {
  const report: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const researcher = await tx.user.create({
        data: { email: 'smoke.researcher@test.local', passwordHash: 'x', fullName: 'Smoke Researcher', role: 'RESEARCHER', affiliation: 'Unipoli' },
      });
      const judge = await tx.user.create({
        data: { email: 'smoke.judge@test.local', passwordHash: 'x', fullName: 'Smoke Judge', role: 'JUDGE' },
      });
      const investor = await tx.user.create({
        data: { email: 'smoke.investor@test.local', passwordHash: 'x', fullName: 'Smoke Investor', role: 'INVESTOR' },
      });
      const admin = await tx.user.create({
        data: { email: 'smoke.admin@test.local', passwordHash: 'x', fullName: 'Smoke Admin', role: 'ADMINISTRATOR', isOwner: true },
      });
      const project = await tx.project.create({ data: { ownerId: researcher.id, title: 'Smoke project' } });
      await tx.projectCollaborator.create({ data: { projectId: project.id, userId: admin.id } });
      const doc = await tx.document.create({
        data: { projectId: project.id, uploadedById: researcher.id, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1234n, storageKey: 'smoke/a.pdf' },
      });
      const chunkId = (
        await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding_vector)
           VALUES (gen_random_uuid(), $1::uuid, 0, 'hello world', $2::vector) RETURNING id`,
          doc.id,
          vec(1),
        )
      )[0].id;
      // extra rows so the planner has something to rank
      // single round trip (remote databases make per-row inserts slow)
      await tx.$executeRawUnsafe(
        `INSERT INTO document_chunks (id, document_id, chunk_index, content, embedding_vector)
         SELECT gen_random_uuid(), $1::uuid, n, 'filler',
                (SELECT array_agg(sin(n + 1 + i))::vector(${DIM}) FROM generate_series(0, ${DIM - 1}) i)
         FROM generate_series(1, 50) n`,
        doc.id,
      );
      const criterion = await tx.evaluationCriterion.create({ data: { name: 'Originality', createdById: admin.id } });
      const assignment = await tx.judgeAssignment.create({ data: { projectId: project.id, judgeId: judge.id, assignedById: admin.id } });
      await tx.evaluation.create({ data: { assignmentId: assignment.id, criterionId: criterion.id, score: 8.5 } });
      await tx.investorProjectLink.create({ data: { investorId: investor.id, projectId: project.id, linkedById: admin.id } });
      await tx.notification.create({ data: { userId: researcher.id, projectId: project.id, title: 'Hi', message: 'Smoke' } });
      const ai = await tx.aiInteractionLog.create({ data: { userId: researcher.id, projectId: project.id, prompt: 'q', response: 'a' } });
      await tx.retrievalAuditLog.create({ data: { interactionId: ai.id, chunkId, similarityScore: 0.99, rank: 1 } });
      report.push('PASS  inserted one row per entity (12/12)');

      // JOIN across related tables
      const rows = await tx.$queryRaw<{ title: string; judge: string; criterion: string; score: string; chunk: string }[]>`
        SELECT p.title, j.full_name AS judge, c.name AS criterion, e.score::text AS score, dc.content AS chunk
        FROM projects p
        JOIN judge_assignments ja ON ja.project_id = p.id
        JOIN users j ON j.id = ja.judge_id
        JOIN evaluations e ON e.assignment_id = ja.id
        JOIN evaluation_criteria c ON c.id = e.criterion_id
        JOIN documents d ON d.project_id = p.id
        JOIN document_chunks dc ON dc.document_id = d.id AND dc.chunk_index = 0
        JOIN retrieval_audit_logs r ON r.chunk_id = dc.id
        JOIN ai_interaction_logs a ON a.id = r.interaction_id
        WHERE p.id = ${project.id}::uuid`;
      if (rows.length !== 1) throw new Error(`JOIN expected 1 row, got ${rows.length}`);
      report.push(`PASS  multi-table JOIN returned: ${JSON.stringify(rows[0])}`);

      // HNSW usage. A 51-row table would normally get a seq scan, so disable it to prove the index is usable.
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const plan = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM document_chunks ORDER BY embedding_vector <=> '${vec(1)}'::vector LIMIT 5`,
      );
      const text = plan
        .map((r) => r['QUERY PLAN'])
        .join('\n')
        .replace(/\[[-0-9.e,]{50,}\]/g, '[<1536-dim vector>]');
      report.push('EXPLAIN:\n' + text.split('\n').map((l) => '        ' + l).join('\n'));
      if (!text.includes('document_chunks_embedding_vector_hnsw_idx')) throw new Error('HNSW index NOT used in plan');
      report.push('PASS  HNSW index used for similarity search');

      throw new Rollback();
    }, { maxWait: 30_000, timeout: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      console.error(report.join('\n'));
      console.error('FAIL ', e);
      process.exitCode = 1;
      return;
    }
  }
  console.log(report.join('\n'));
  console.log('Smoke test OK (transaction rolled back, database left clean).');
}

main().finally(() => prisma.$disconnect());
