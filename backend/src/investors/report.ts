import PDFDocument from 'pdfkit';
import type { getResults } from '../evaluations/evaluations.service';

export interface ReportData {
  title: string;
  status: string;
  allowedNext: string[];
  owner: string;
  researchArea: string | null;
  affiliation: string | null;
  summary: string | null;
  description: string | null;
  createdAt: Date;
  progressPercent: number;
  milestones: Array<{ title: string; dueDate: string | null; completed: boolean }>;
  evaluation: Awaited<ReturnType<typeof getResults>>;
  generatedBy: string;
}

const STATUS_ES: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviado',
  UNDER_EVALUATION: 'En evaluación',
  EVALUATED: 'Evaluado',
  ARCHIVED: 'Archivado',
};

const PURPLE = '#6d2a96';

/** Renders the project report to a Buffer. Built-in Helvetica covers the Spanish accents (WinAnsi). */
export function renderProjectReport(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Reporte - ${data.title}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const heading = (text: string) => {
      doc.moveDown(0.8).fillColor(PURPLE).font('Helvetica-Bold').fontSize(13).text(text).fillColor('#111827');
      doc.moveDown(0.2).font('Helvetica').fontSize(10.5);
    };

    doc.rect(0, 0, doc.page.width, 8).fill(PURPLE);
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9).text('Plataforma de Proyectos de Investigación · UNIPOLI', 50, 30);
    doc.moveDown(0.5).fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(data.title);
    doc.moveDown(0.3).font('Helvetica').fontSize(10.5).fillColor('#374151');
    doc.text(`Estado: ${STATUS_ES[data.status] ?? data.status}`);
    doc.text(`Investigador responsable: ${data.owner}`);
    if (data.researchArea) doc.text(`Área de investigación: ${data.researchArea}`);
    if (data.affiliation) doc.text(`Afiliación: ${data.affiliation}`);
    doc.text(`Registrado el ${data.createdAt.toLocaleDateString('es-MX')}`);
    doc.fillColor('#111827');

    if (data.summary) {
      heading('Resumen');
      doc.text(data.summary);
    }
    if (data.description) {
      heading('Descripción');
      doc.text(data.description);
    }

    heading(`Avance: ${data.progressPercent}%`);
    const barY = doc.y + 2;
    doc.rect(50, barY, 495, 8).fill('#e5e7eb');
    doc.rect(50, barY, (495 * data.progressPercent) / 100, 8).fill(PURPLE);
    doc.y = barY + 16;
    doc.fillColor('#111827');
    if (data.milestones.length === 0) doc.text('Aún no hay hitos registrados.');
    for (const m of data.milestones) {
      doc.text(`${m.completed ? '[x]' : '[ ]'} ${m.title}${m.dueDate ? `  (fecha límite ${m.dueDate})` : ''}`);
    }

    heading('Evaluación');
    const ev = data.evaluation;
    doc.text(`Jueces asignados: ${ev.judgesAssigned} · Evaluaciones enviadas: ${ev.judgesCompleted}`);
    if (!ev.results) {
      doc.moveDown(0.3).text('Los resultados se publicarán cuando finalice el periodo de evaluación.');
    } else {
      if (ev.results.overallPercent !== null) {
        doc.font('Helvetica-Bold').text(`Calificación global ponderada: ${ev.results.overallPercent}%`).font('Helvetica');
      }
      doc.moveDown(0.3);
      for (const c of ev.results.criteria) {
        doc.font('Helvetica-Bold').text(`${c.name}: ${c.average ?? '—'} / ${c.maxScore} (peso ${c.weight})`).font('Helvetica');
        for (const comment of c.comments) doc.fillColor('#4b5563').text(`  “${comment.comment}”`).fillColor('#111827');
      }
    }

    doc.moveDown(1.5).fillColor('#9ca3af').fontSize(8.5).text(
      `Generado el ${new Date().toLocaleString('es-MX')} por ${data.generatedBy}`,
      { align: 'right' },
    );
    doc.end();
  });
}
