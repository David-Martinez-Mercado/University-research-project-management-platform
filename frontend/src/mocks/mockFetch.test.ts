import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from './mockFetch';

const call = (path: string, init?: RequestInit) => mockFetch(`http://api.test${path}`, init);

function upload(projectId: string, file: File, type = 'REPORT') {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file);
  return call(`/projects/${projectId}/documents`, { method: 'POST', body: form });
}

afterEach(() => vi.unstubAllGlobals());

describe('mock documents API (only active with VITE_USE_MOCKS=true)', () => {
  it('passes everything that is not a documents endpoint to the real network', async () => {
    const real = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', real);
    await call('/projects', { method: 'GET' });
    await call('/auth/login', { method: 'POST' });
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('stores an upload, lists it and serves it back', async () => {
    const res = await upload('mock-1', new File(['contenido'], 'nota.md'));
    expect(res.status).toBe(201);
    const list = (await (await call('/projects/mock-1/documents')).json()) as {
      data: Array<{ id: string; fileName: string; ingestionStatus: string; type: string }>;
    };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ fileName: 'nota.md', ingestionStatus: 'PENDING', type: 'REPORT' });
    const file = await call(`/projects/mock-1/documents/${list.data[0].id}/download`);
    expect(await file.text()).toBe('contenido');
    const other = (await (await call('/projects/other-project/documents')).json()) as { data: unknown[] };
    expect(other.data).toEqual([]);
  });

  it('rejects like the real contract: 413 over 10 MB, 415 for an unsupported extension, 400 for a bad type enum', async () => {
    const big = new File(['x'], 'grande.pdf');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    expect((await upload('mock-2', big)).status).toBe(413);
    expect((await upload('mock-2', new File(['x'], 'virus.exe'))).status).toBe(415);
    expect((await upload('mock-2', new File(['x'], 'ok.pdf'), 'NOPE')).status).toBe(400);
    expect((await call('/projects/mock-2/documents/nope/download')).status).toBe(404);
  });
});
