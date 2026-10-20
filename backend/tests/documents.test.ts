import type { ProjectStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { sanitizeFileName } from '../src/documents/documents.content';
import { DOCUMENT_UPLOADED, documentEvents, type DocumentUploadedEvent } from '../src/documents/documents.events';
import { setStorageForTests } from '../src/documents/storage';
import { api, bearer, loginAs, makeUser, resetDb } from './helpers';
import {
  EXE_BYTES,
  makeDocx,
  makeZip,
  MD_BYTES,
  MemoryStorage,
  PDF_BYTES,
  PNG_BYTES,
  rawMultipart,
  TXT_BYTES,
} from './upload-fixtures';

let storage: MemoryStorage;
let uploaded: DocumentUploadedEvent[];
const onUploaded = (e: DocumentUploadedEvent) => uploaded.push(e);
const originalMaxMb = env.MAX_UPLOAD_MB;

beforeEach(async () => {
  await resetDb();
  storage = new MemoryStorage();
  setStorageForTests(storage);
  uploaded = [];
  documentEvents.on(DOCUMENT_UPLOADED, onUploaded);
});
afterEach(() => {
  documentEvents.off(DOCUMENT_UPLOADED, onUploaded);
  env.MAX_UPLOAD_MB = originalMaxMb;
});
afterAll(async () => {
  setStorageForTests(undefined);
  await prisma.$disconnect();
});

async function as(role: Role) {
  const user = await makeUser(role);
  const { token } = await loginAs(user.email);
  return { user, token, h: bearer(token) };
}
type Actor = Awaited<ReturnType<typeof as>>;

const mkProject = (ownerId: string, status: ProjectStatus = 'DRAFT') =>
  prisma.project.create({ data: { ownerId, title: 'Quantum sensing', description: 'desc', status } });

const upload = (a: Actor, projectId: string, file: Buffer, filename: string, type?: string) => {
  const req = api().post(`/projects/${projectId}/documents`).set(a.h);
  if (type !== undefined) req.field('type', type);
  return req.attach('file', file, { filename, contentType: 'application/octet-stream' });
};

async function expectNothingSaved(projectId?: string) {
  expect(await prisma.document.count(projectId ? { where: { projectId } } : undefined)).toBe(0);
  expect(storage.files.size).toBe(0);
  expect(uploaded).toHaveLength(0);
}

/** Researcher who owns a DRAFT project. */
async function setup() {
  const owner = await as('RESEARCHER');
  const project = await mkProject(owner.user.id);
  return { owner, project };
}

describe('authentication', () => {
  it('returns 401 without a token on every documents endpoint', async () => {
    const id = randomUUID();
    const calls = [
      api().post(`/projects/${id}/documents`),
      api().get(`/projects/${id}/documents`),
      api().get(`/projects/${id}/documents/${id}/download`),
    ];
    for (const c of calls) expect((await c).status).toBe(401);
  });
});

describe('POST /projects/:id/documents - happy path', () => {
  const cases: Array<[string, () => Buffer, string, string]> = [
    ['PDF', () => PDF_BYTES, 'proposal.pdf', 'application/pdf'],
    ['DOCX', makeDocx, 'proposal.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['TXT', () => TXT_BYTES, 'notes.txt', 'text/plain'],
    ['MD', () => MD_BYTES, 'README.md', 'text/markdown'],
  ];

  it.each(cases)('accepts a valid %s: row, bytes, PENDING status and one event', async (_label, make, filename, mime) => {
    const { owner, project } = await setup();
    const bytes = make();
    const res = await upload(owner, project.id, bytes, filename, 'PROPOSAL');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      projectId: project.id,
      fileName: filename,
      mimeType: mime, // derived on the server, not the client's application/octet-stream
      sizeBytes: bytes.length,
      type: 'PROPOSAL',
      ingestionStatus: 'PENDING',
      uploadedAt: expect.any(String),
      uploadedBy: { id: owner.user.id, fullName: owner.user.fullName },
    });
    expect(typeof res.body.sizeBytes).toBe('number');

    const row = await prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.storageKey).toMatch(new RegExp(`^projects/${project.id}/[0-9a-f-]{36}$`));
    expect(row.ingestionStatus).toBe('PENDING');
    expect(storage.files.get(row.storageKey)?.equals(bytes)).toBe(true);
    expect(storage.files.size).toBe(1);
    expect(uploaded).toEqual([{ documentId: res.body.id, projectId: project.id }]); // exactly once
  });

  it('defaults type to OTHER', async () => {
    const { owner, project } = await setup();
    const res = await upload(owner, project.id, TXT_BYTES, 'a.txt');
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('OTHER');
  });

  it('stores unicode names intact and serves them with RFC 5987 headers', async () => {
    const { owner, project } = await setup();
    const res = await upload(owner, project.id, TXT_BYTES, 'Propuesta ñandú.txt');
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe('Propuesta ñandú.txt');
    const dl = await api().get(`/projects/${project.id}/documents/${res.body.id}/download`).set(owner.h);
    expect(dl.headers['content-disposition']).toBe(
      `attachment; filename="Propuesta _and_.txt"; filename*=UTF-8''Propuesta%20%C3%B1and%C3%BA.txt`,
    );
  });

  it('emits only after the row is committed and the bytes are saved', async () => {
    const { owner, project } = await setup();
    documentEvents.off(DOCUMENT_UPLOADED, onUploaded);
    const probes: Array<Promise<{ rows: number; bytes: boolean }>> = [];
    const listener = (e: DocumentUploadedEvent) => {
      // At emit time the row must already be visible to OTHER connections (committed) and the bytes stored.
      const bytes = storage.files.size === 1;
      probes.push(prisma.document.count({ where: { id: e.documentId } }).then((rows) => ({ rows, bytes })));
    };
    documentEvents.on(DOCUMENT_UPLOADED, listener);
    try {
      const res = await upload(owner, project.id, TXT_BYTES, 'a.txt');
      expect(res.status).toBe(201);
      expect(await Promise.all(probes)).toEqual([{ rows: 1, bytes: true }]);
    } finally {
      documentEvents.off(DOCUMENT_UPLOADED, listener);
    }
  });

  it('a throwing listener does not turn a successful upload into an error', async () => {
    const { owner, project } = await setup();
    const boom = () => {
      throw new Error('listener bug');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    documentEvents.on(DOCUMENT_UPLOADED, boom);
    try {
      const res = await upload(owner, project.id, TXT_BYTES, 'a.txt');
      expect(res.status).toBe(201);
    } finally {
      documentEvents.off(DOCUMENT_UPLOADED, boom);
      spy.mockRestore();
    }
  });
});

describe('POST /projects/:id/documents - validation rejects and saves nothing', () => {
  it('rejects disallowed extensions (415)', async () => {
    const { owner, project } = await setup();
    for (const [bytes, name] of [
      [EXE_BYTES, 'virus.exe'],
      [PNG_BYTES, 'image.png'],
      [TXT_BYTES, 'data.csv'],
      [TXT_BYTES, 'page.html'],
      [TXT_BYTES, 'noextension'],
      [TXT_BYTES, '.txt'], // hidden-file style: no real extension once the leading dot is stripped
    ] as const) {
      const res = await upload(owner, project.id, bytes, name);
      expect(res.status, name).toBe(415);
    }
    await expectNothingSaved();
  });

  it('rejects a fake extension whose content does not match (415)', async () => {
    const { owner, project } = await setup();
    const cases: Array<[Buffer, string]> = [
      [EXE_BYTES, 'report.pdf'], // executable renamed to .pdf
      [PNG_BYTES, 'report.pdf'],
      [TXT_BYTES, 'report.pdf'], // text is not a PDF
      [TXT_BYTES, 'report.docx'],
      [PDF_BYTES, 'report.docx'],
      [makeZip({ 'readme.txt': 'hi' }), 'report.docx'], // a zip, but not a Word document
      [makeZip({ '[Content_Types].xml': '<x/>' }), 'report.docx'], // no word/document.xml
      [Buffer.from('PK\x03\x04 truncated, no central directory', 'latin1'), 'report.docx'],
      [Buffer.from([0x68, 0x69, 0x00, 0x21]), 'notes.txt'], // NUL byte
      [Buffer.from([0xff, 0xfe, 0xfd, 0x41]), 'notes.md'], // invalid UTF-8
      [EXE_BYTES, 'notes.txt'],
    ];
    for (const [bytes, name] of cases) {
      const res = await upload(owner, project.id, bytes, name);
      expect(res.status, `${name} ${bytes.subarray(0, 6).toString('hex')}`).toBe(415);
    }
    await expectNothingSaved();
  });

  it('does not trust the client MIME type', async () => {
    const { owner, project } = await setup();
    const res = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .attach('file', EXE_BYTES, { filename: 'report.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
    await expectNothingSaved();
  });

  it('rejects an empty file (400) and a missing file (400)', async () => {
    const { owner, project } = await setup();
    expect((await upload(owner, project.id, Buffer.alloc(0), 'empty.txt')).status).toBe(400);
    expect((await api().post(`/projects/${project.id}/documents`).set(owner.h).field('type', 'REPORT')).status).toBe(400);
    expect((await api().post(`/projects/${project.id}/documents`).set(owner.h).send({ type: 'REPORT' })).status).toBe(400);
    await expectNothingSaved();
  });

  it('rejects a file sent under the wrong field name and more than one file (400)', async () => {
    const { owner, project } = await setup();
    const wrongField = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .attach('document', TXT_BYTES, { filename: 'a.txt' });
    expect(wrongField.status).toBe(400);
    const two = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .attach('file', TXT_BYTES, { filename: 'a.txt' })
      .attach('file', TXT_BYTES, { filename: 'b.txt' });
    expect(two.status).toBe(400);
    await expectNothingSaved();
  });

  it('rejects an invalid or unknown form field (400)', async () => {
    const { owner, project } = await setup();
    expect((await upload(owner, project.id, TXT_BYTES, 'a.txt', 'SECRET')).status).toBe(400);
    const extra = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .field('projectId', randomUUID())
      .attach('file', TXT_BYTES, { filename: 'a.txt' });
    expect(extra.status).toBe(400);
    await expectNothingSaved();
  });

  it('enforces MAX_UPLOAD_MB with 413 (and allows a file of exactly the limit)', async () => {
    const { owner, project } = await setup();
    env.MAX_UPLOAD_MB = 0.001; // 1048 bytes
    const limit = Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);

    const tooBig = await upload(owner, project.id, Buffer.alloc(limit + 1, 0x61), 'big.txt');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toMatch(/too large/i);
    await expectNothingSaved();

    const exact = await upload(owner, project.id, Buffer.alloc(limit, 0x61), 'exact.txt');
    expect(exact.status).toBe(201);
  });

  it('answers malformed multipart bodies with 400, never 500', async () => {
    const { owner, project } = await setup();
    const truncated = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhalf a file');
    expect(truncated.status).toBe(400);
    const noBoundary = await api()
      .post(`/projects/${project.id}/documents`)
      .set(owner.h)
      .set('Content-Type', 'multipart/form-data')
      .send('garbage');
    expect(noBoundary.status).toBe(400);
    await expectNothingSaved();
  });

  it('neutralizes path-traversal and control characters in file names', async () => {
    const { owner, project } = await setup();
    const cases: Array<[string, string]> = [
      ['../../etc/passwd.txt', 'passwd.txt'],
      [['..', '..', 'windows', 'evil.txt'].join(String.fromCharCode(92)), 'evil.txt'],
      ['/absolute/path/x.txt', 'x.txt'],
      [['C:', 'Users', 'me', 'y.txt'].join(String.fromCharCode(92)), 'y.txt'],
      [`bi${String.fromCharCode(0x202e)}di.txt`, 'bidi.txt'],
    ];
    for (const [name, expected] of cases) {
      // Raw body so the traversal sequences really reach the server (client libraries strip paths).
      const { body, contentType } = rawMultipart([{ name: 'file', filename: name, data: TXT_BYTES }]);
      const res = await api().post(`/projects/${project.id}/documents`).set(owner.h).set('Content-Type', contentType).send(body);
      expect(res.status, name).toBe(201);
      expect(res.body.fileName).toBe(expected);
    }
    for (const key of storage.files.keys()) {
      expect(key).toMatch(new RegExp(`^projects/${project.id}/[0-9a-f-]{36}$`)); // names never reach the storage key
    }
    const rows = await prisma.document.findMany();
    for (const r of rows) expect(r.fileName).not.toMatch(/[\\/\u0000-\u001f]/);
  });

  it('control characters in a raw file name header are refused by the parser (400), not stored', async () => {
    const { owner, project } = await setup();
    const { body, contentType } = rawMultipart([{ name: 'file', filename: 'bell\u0007.txt', data: TXT_BYTES }]);
    const res = await api().post(`/projects/${project.id}/documents`).set(owner.h).set('Content-Type', contentType).send(body);
    expect(res.status).toBe(400);
    await expectNothingSaved();
  });

  it('rejects a traversal name whose remaining part has no allowed extension', async () => {
    const { owner, project } = await setup();
    const { body, contentType } = rawMultipart([{ name: 'file', filename: '../../etc/passwd', data: TXT_BYTES }]);
    const res = await api().post(`/projects/${project.id}/documents`).set(owner.h).set('Content-Type', contentType).send(body);
    expect(res.status).toBe(415);
    await expectNothingSaved();
  });

  it('removes the stored bytes and emits nothing if the database insert fails', async () => {
    const { owner, project } = await setup();
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await upload(owner, project.id, TXT_BYTES, 'a.txt');
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
    await expectNothingSaved();
  });

  it('returns 400 for a non-uuid project id', async () => {
    const owner = await as('RESEARCHER');
    const res = await upload(owner, 'not-a-uuid', TXT_BYTES, 'a.txt');
    expect(res.status).toBe(400);
  });
});

describe('POST /projects/:id/documents - permissions', () => {
  it.each(['JUDGE', 'INVESTOR'] as const)('forbids %s (403) even when assigned / linked', async (role) => {
    const { project } = await setup();
    const a = await as(role);
    if (role === 'JUDGE') {
      const admin = await makeUser('ADMINISTRATOR');
      await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: a.user.id, assignedById: admin.id } });
    } else {
      const admin = await makeUser('ADMINISTRATOR');
      await prisma.investorProjectLink.create({ data: { projectId: project.id, investorId: a.user.id, linkedById: admin.id } });
    }
    const res = await upload(a, project.id, TXT_BYTES, 'a.txt');
    expect(res.status).toBe(403);
    await expectNothingSaved();
  });

  it('returns 404 (not 403) to a researcher/student who cannot see the project', async () => {
    const { project } = await setup();
    for (const role of ['RESEARCHER', 'STUDENT'] as const) {
      const outsider = await as(role);
      expect((await upload(outsider, project.id, TXT_BYTES, 'a.txt')).status).toBe(404);
    }
    expect((await upload(await as('ADMINISTRATOR'), randomUUID(), TXT_BYTES, 'a.txt')).status).toBe(404);
    await expectNothingSaved();
  });

  it('lets collaborators (MEMBER and LEAD, researcher and student) and administrators upload', async () => {
    const { project } = await setup();
    const member = await as('STUDENT');
    const lead = await as('RESEARCHER');
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: member.user.id, role: 'MEMBER' } });
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: lead.user.id, role: 'LEAD' } });
    const admin = await as('ADMINISTRATOR');
    for (const a of [member, lead, admin]) {
      const res = await upload(a, project.id, TXT_BYTES, 'a.txt');
      expect(res.status).toBe(201);
      expect(res.body.uploadedBy.id).toBe(a.user.id);
    }
    expect(uploaded).toHaveLength(3);
  });

  it.each([
    ['DRAFT', 201],
    ['SUBMITTED', 201],
    ['UNDER_EVALUATION', 409],
    ['EVALUATED', 409],
    ['ARCHIVED', 409],
  ] as const)('project in %s -> %i (also for administrators)', async (status, expected) => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const project = await mkProject(owner.user.id, status);
    expect((await upload(owner, project.id, TXT_BYTES, 'a.txt')).status).toBe(expected);
    expect((await upload(admin, project.id, TXT_BYTES, 'b.txt')).status).toBe(expected);
    if (expected === 409) await expectNothingSaved();
  });

  it('does not accept an upload that races with a status change (row lock) and cleans the bytes', async () => {
    const { owner, project } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let updated!: () => void;
    const updatedSignal = new Promise<void>((r) => (updated = r));

    // An in-flight, uncommitted DRAFT -> UNDER_EVALUATION change holds the project row.
    const holder = prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: project.id }, data: { status: 'UNDER_EVALUATION' } });
      updated();
      await gate;
    });
    await updatedSignal;

    // The pre-check still sees DRAFT (uncommitted change is invisible); the transaction then waits on the lock.
    const pending = upload(owner, project.id, TXT_BYTES, 'a.txt').then((r) => r);
    await new Promise((r) => setTimeout(r, 400));
    release();
    await holder;

    const res = await pending;
    expect(res.status).toBe(409);
    await expectNothingSaved();
  });
});

describe('GET /projects/:id/documents', () => {
  async function seed() {
    const { owner, project } = await setup();
    const other = await mkProject(owner.user.id);
    const d1 = await upload(owner, project.id, TXT_BYTES, 'one.txt', 'REPORT');
    const d2 = await upload(owner, project.id, PDF_BYTES, 'two.pdf', 'PROPOSAL');
    const dOther = await upload(owner, other.id, MD_BYTES, 'other.md');
    return { owner, project, other, d1: d1.body, d2: d2.body, dOther: dOther.body };
  }

  it('lists only the documents of the project, with the documented shape', async () => {
    const { owner, project, d1, d2 } = await seed();
    const res = await api().get(`/projects/${project.id}/documents`).set(owner.h);
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { id: string }) => d.id).sort()).toEqual([d1.id, d2.id].sort());
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      projectId: project.id,
      fileName: expect.any(String),
      mimeType: expect.any(String),
      sizeBytes: expect.any(Number),
      type: expect.any(String),
      ingestionStatus: 'PENDING',
      uploadedAt: expect.any(String),
      uploadedBy: { id: owner.user.id, fullName: owner.user.fullName },
    });
    expect(JSON.stringify(res.body)).not.toContain('storageKey');
  });

  it('scopes by role with real rows', async () => {
    const { project, other } = await seed();
    const admin = await as('ADMINISTRATOR');
    const member = await as('STUDENT');
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: member.user.id } });
    const outsider = await as('RESEARCHER');
    const assignedJudge = await as('JUDGE');
    const otherJudge = await as('JUDGE');
    await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: assignedJudge.user.id, assignedById: admin.user.id } });
    const linkedInvestor = await as('INVESTOR');
    await prisma.investorProjectLink.create({ data: { projectId: project.id, investorId: linkedInvestor.user.id, linkedById: admin.user.id } });

    const list = (a: Actor, id: string) => api().get(`/projects/${id}/documents`).set(a.h);

    expect((await list(admin, project.id)).body.data).toHaveLength(2);
    expect((await list(admin, other.id)).body.data).toHaveLength(1);
    expect((await list(member, project.id)).body.data).toHaveLength(2);
    expect((await list(member, other.id)).status).toBe(404); // collaborates on one project only
    expect((await list(assignedJudge, project.id)).body.data).toHaveLength(2);
    expect((await list(assignedJudge, other.id)).status).toBe(404);
    expect((await list(otherJudge, project.id)).status).toBe(404);
    expect((await list(outsider, project.id)).status).toBe(404);
    expect((await list(linkedInvestor, project.id)).status).toBe(403); // investors never read documents
    expect((await list(admin, randomUUID())).status).toBe(404);
    expect((await list(admin, 'nope')).status).toBe(400);
  });

  it('revokes access when the collaborator is removed or the judge assignment is deleted', async () => {
    const { project } = await seed();
    const admin = await as('ADMINISTRATOR');
    const member = await as('RESEARCHER');
    const judge = await as('JUDGE');
    await prisma.projectCollaborator.create({ data: { projectId: project.id, userId: member.user.id } });
    const assignment = await prisma.judgeAssignment.create({
      data: { projectId: project.id, judgeId: judge.user.id, assignedById: admin.user.id },
    });
    expect((await api().get(`/projects/${project.id}/documents`).set(member.h)).status).toBe(200);
    expect((await api().get(`/projects/${project.id}/documents`).set(judge.h)).status).toBe(200);
    await prisma.projectCollaborator.deleteMany({ where: { userId: member.user.id } });
    await prisma.judgeAssignment.delete({ where: { id: assignment.id } });
    expect((await api().get(`/projects/${project.id}/documents`).set(member.h)).status).toBe(404);
    expect((await api().get(`/projects/${project.id}/documents`).set(judge.h)).status).toBe(404);
  });

  it('judges can read documents of any project status', async () => {
    const owner = await as('RESEARCHER');
    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE');
    const project = await mkProject(owner.user.id, 'SUBMITTED');
    await upload(owner, project.id, TXT_BYTES, 'a.txt');
    await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: judge.user.id, assignedById: admin.user.id } });
    await prisma.project.update({ where: { id: project.id }, data: { status: 'UNDER_EVALUATION' } });
    const res = await api().get(`/projects/${project.id}/documents`).set(judge.h);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /projects/:id/documents/:docId/download', () => {
  it('streams the exact bytes with safe headers', async () => {
    const { owner, project } = await setup();
    const docx = makeDocx();
    const created = await upload(owner, project.id, docx, 'My "proposal".docx');
    expect(created.status).toBe(201);

    const res = await api()
      .get(`/projects/${project.id}/documents/${created.body.id}/download`)
      .set(owner.h)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).equals(docx)).toBe(true);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="My _proposal_\.docx"; filename\*=UTF-8''/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-length']).toBe(String(docx.length));
  });

  it('serves text with an explicit charset and still as an attachment', async () => {
    const { owner, project } = await setup();
    const created = await upload(owner, project.id, MD_BYTES, 'notes.md');
    const res = await api().get(`/projects/${project.id}/documents/${created.body.id}/download`).set(owner.h);
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('enforces the same visibility and role rules as the list (and 404 for unknown or foreign document ids)', async () => {
    const { owner, project } = await setup();
    const other = await mkProject(owner.user.id);
    const doc = (await upload(owner, project.id, TXT_BYTES, 'a.txt')).body;
    const otherDoc = (await upload(owner, other.id, TXT_BYTES, 'b.txt')).body;

    const admin = await as('ADMINISTRATOR');
    const judge = await as('JUDGE');
    const stranger = await as('JUDGE');
    const investor = await as('INVESTOR');
    const outsider = await as('STUDENT');
    await prisma.judgeAssignment.create({ data: { projectId: project.id, judgeId: judge.user.id, assignedById: admin.user.id } });
    await prisma.investorProjectLink.create({ data: { projectId: project.id, investorId: investor.user.id, linkedById: admin.user.id } });

    const dl = (a: Actor, pid: string, did: string) => api().get(`/projects/${pid}/documents/${did}/download`).set(a.h);
    expect((await dl(owner, project.id, doc.id)).status).toBe(200);
    expect((await dl(admin, project.id, doc.id)).status).toBe(200);
    expect((await dl(judge, project.id, doc.id)).status).toBe(200);
    expect((await dl(stranger, project.id, doc.id)).status).toBe(404);
    expect((await dl(outsider, project.id, doc.id)).status).toBe(404);
    expect((await dl(investor, project.id, doc.id)).status).toBe(403);
    // Using a visible project id with a document that belongs to another project must not leak it.
    expect((await dl(judge, project.id, otherDoc.id)).status).toBe(404);
    expect((await dl(owner, project.id, randomUUID())).status).toBe(404);
    expect((await dl(owner, project.id, 'nope')).status).toBe(400);
  });

  it('returns 404 if the stored bytes are gone', async () => {
    const { owner, project } = await setup();
    const doc = (await upload(owner, project.id, TXT_BYTES, 'a.txt')).body;
    storage.files.clear();
    const res = await api().get(`/projects/${project.id}/documents/${doc.id}/download`).set(owner.h);
    expect(res.status).toBe(404);
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['plain.pdf', 'plain.pdf'],
    ['../../a.pdf', 'a.pdf'],
    ['..\\..\\a.pdf', 'a.pdf'],
    ['dir/sub/a b.pdf', 'a b.pdf'],
    ['  spaced   out .txt', 'spaced out .txt'],
    ['tab\tname.txt', 'tab name.txt'],
    ['a\u0000b.txt', 'ab.txt'],
    ['a\u200Bb.txt', 'ab.txt'],
    ['q<u>o:t"e|s?.txt', 'q_u_o_t_e_s_.txt'],
    ['.hidden.txt', 'hidden.txt'],
    ['trailing.dots...', 'trailing.dots'],
    ['', ''],
    ['...', ''],
  ])('%j -> %j', (input, output) => {
    expect(sanitizeFileName(input)).toBe(output);
  });

  it('caps the length but keeps the extension', () => {
    const out = sanitizeFileName('x'.repeat(500) + '.pdf');
    expect(Array.from(out).length).toBe(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});
