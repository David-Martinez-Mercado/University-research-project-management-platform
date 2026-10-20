import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../../auth/tokenStore';
import { saveBlob } from '../../lib/saveBlob';
import {
  callsTo,
  jsonResponse,
  makeCollaborator,
  makeDocument,
  makeProject,
  makeUser,
  renderApp,
  signedInAs,
  type RouteHandler,
} from '../../test/helpers';

vi.mock('../../lib/saveBlob', () => ({ saveBlob: vi.fn() }));

const owner = makeUser('RESEARCHER');
const project = makeProject({ ownerId: owner.id });
const base = `/projects/${project.id}`;

function openDocuments(routes: Record<string, RouteHandler | Response | (() => Response)>, user = owner, current = project) {
  const fetchMock = signedInAs(user, {
    [`GET ${base}`]: () => jsonResponse(200, current),
    [`GET ${base}/collaborators`]: () => jsonResponse(200, { data: [makeCollaborator({ userId: owner.id })] }),
    ...routes,
  });
  renderApp(`${base}?tab=documents`);
  return fetchMock;
}

beforeEach(() => vi.mocked(saveBlob).mockClear());

describe('Documents tab', () => {
  it('lists name, type, size, uploader, date and an ingestion badge with text for every status', async () => {
    openDocuments({
      [`GET ${base}/documents`]: () =>
        jsonResponse(200, {
          data: [
            makeDocument({ id: 'd1', fileName: 'propuesta.pdf', type: 'PROPOSAL', sizeBytes: 2048, ingestionStatus: 'READY', uploadedBy: { id: 'u', fullName: 'Rita Researcher' } }),
            makeDocument({ id: 'd2', fileName: 'datos.txt', type: 'DATASET', sizeBytes: 3 * 1024 * 1024, ingestionStatus: 'FAILED' }),
            makeDocument({ id: 'd3', fileName: 'a.md', ingestionStatus: 'PENDING' }),
            makeDocument({ id: 'd4', fileName: 'b.docx', ingestionStatus: 'PROCESSING' }),
          ],
        }),
    });

    const list = await screen.findByRole('region', { name: 'Documentos del proyecto' });
    const items = await within(list).findAllByRole('listitem');
    expect(items).toHaveLength(4);
    const first = within(items[0]);
    expect(first.getByText('propuesta.pdf')).toBeInTheDocument();
    expect(first.getByText('Propuesta')).toBeInTheDocument();
    expect(first.getByText('2.0 KB')).toBeInTheDocument();
    expect(first.getByText('Rita Researcher')).toBeInTheDocument();
    expect(first.getByText('Listo')).toBeInTheDocument();
    expect(within(items[1]).getByText('3.0 MB')).toBeInTheDocument();
    expect(within(items[1]).getByText('Falló')).toBeInTheDocument();
    expect(within(items[2]).getByText('Pendiente')).toBeInTheDocument();
    expect(within(items[3]).getByText('Procesando')).toBeInTheDocument();
  });

  it('shows an empty state, and a retryable error state', async () => {
    let fail = true;
    openDocuments({
      [`GET ${base}/documents`]: () => (fail ? jsonResponse(500, { error: 'boom' }) : jsonResponse(200, { data: [] })),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Aún no hay documentos')).toBeInTheDocument();
  });

  it('uploads type + file as multipart, refreshes the list and applies the sliding token', async () => {
    let uploaded = false;
    const fetchMock = openDocuments({
      [`GET ${base}/documents`]: () => jsonResponse(200, { data: uploaded ? [makeDocument({ fileName: 'informe.pdf', type: 'REPORT', ingestionStatus: 'PENDING' })] : [] }),
      [`POST ${base}/documents`]: () => {
        uploaded = true;
        return jsonResponse(201, makeDocument({ fileName: 'informe.pdf' }), { 'X-Auth-Token': 'jwt-after-upload' });
      },
    });
    const user = userEvent.setup();

    await screen.findByText('Aún no hay documentos');
    await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'REPORT');
    await user.upload(screen.getByLabelText('Archivo'), new File(['hola'], 'informe.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Subir documento' }));

    expect(await screen.findByText('informe.pdf', { selector: 'p.break-all' })).toBeInTheDocument();
    expect(screen.getByText(/se subió correctamente/)).toBeInTheDocument();

    const [, init] = callsTo(fetchMock, `POST ${base}/documents`)[0];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init!.body as FormData;
    expect([...form.keys()]).toEqual(['type', 'file']); // type first, then the file
    expect(form.get('type')).toBe('REPORT');
    expect((form.get('file') as File).name).toBe('informe.pdf');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-test');
    expect(headers.has('Content-Type')).toBe(false); // the browser sets the multipart boundary
    expect(tokenStore.get()).toBe('jwt-after-upload');
  });

  it('asks for a file when none is selected', async () => {
    const fetchMock = openDocuments({ [`GET ${base}/documents`]: () => jsonResponse(200, { data: [] }) });
    await screen.findByText('Aún no hay documentos');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subir documento' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Selecciona un archivo para subir.');
    expect(callsTo(fetchMock, `POST ${base}/documents`)).toHaveLength(0);
  });

  it('hints (without blocking) when the file looks too big or of an unsupported type', async () => {
    const fetchMock = openDocuments({
      [`GET ${base}/documents`]: () => jsonResponse(200, { data: [] }),
      [`POST ${base}/documents`]: () => jsonResponse(415, { error: 'Unsupported file type; allowed extensions: pdf, docx, txt, md' }),
    });
    const user = userEvent.setup({ applyAccept: false });
    await screen.findByText('Aún no hay documentos');

    const big = new File(['x'], 'virus.exe');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('Archivo'), big);

    expect(screen.getByRole('status')).toHaveTextContent('su formato no es PDF, DOCX, TXT ni MD y pesa más de 10 MB');
    // Not blocked: the server is the authority and still receives the request.
    await user.click(screen.getByRole('button', { name: 'Subir documento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El tipo de archivo no es compatible');
    expect(callsTo(fetchMock, `POST ${base}/documents`)).toHaveLength(1);
  });

  it.each([
    [413, 'El archivo supera el tamaño máximo permitido (10 MB).'],
    [415, 'El tipo de archivo no es compatible, o su contenido no coincide con su extensión.'],
    [400, 'El servidor rechazó el archivo (por ejemplo, está vacío'],
    [403, 'No tienes permiso para subir documentos a este proyecto.'],
    [404, 'El proyecto ya no existe o no tienes acceso a él.'],
    [409, 'Solo se pueden subir documentos mientras el proyecto está en Borrador o Enviado.'],
  ])('maps the %s of an upload', async (status, message) => {
    openDocuments({
      [`GET ${base}/documents`]: () => jsonResponse(200, { data: [] }),
      [`POST ${base}/documents`]: () => jsonResponse(status, { error: 'x' }),
    });
    const user = userEvent.setup();
    await screen.findByText('Aún no hay documentos');
    await user.upload(screen.getByLabelText('Archivo'), new File(['x'], 'a.pdf'));
    await user.click(screen.getByRole('button', { name: 'Subir documento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Subir documento' })).toBeEnabled();
  });

  it('downloads through an authenticated fetch (Blob), not a bare link, and applies the sliding token', async () => {
    const doc = makeDocument({ id: 'doc-9', fileName: 'propuesta.pdf' });
    const fetchMock = openDocuments({
      [`GET ${base}/documents`]: () => jsonResponse(200, { data: [doc] }),
      [`GET ${base}/documents/doc-9/download`]: () =>
        new Response('%PDF-bytes', { status: 200, headers: { 'Content-Type': 'application/pdf', 'X-Auth-Token': 'jwt-after-download' } }),
    });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Descargar propuesta.pdf' }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledOnce());
    const [blob, fileName] = vi.mocked(saveBlob).mock.calls[0];
    expect(fileName).toBe('propuesta.pdf');
    expect(await (blob as Blob).text()).toBe('%PDF-bytes');
    const [, init] = callsTo(fetchMock, `GET ${base}/documents/doc-9/download`)[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt-test');
    expect(tokenStore.get()).toBe('jwt-after-download');
    expect(screen.queryByRole('link', { name: /Descargar/ })).not.toBeInTheDocument();
  });

  it('shows a readable error when the download fails', async () => {
    openDocuments({
      [`GET ${base}/documents`]: () => jsonResponse(200, { data: [makeDocument({ id: 'doc-9' })] }),
      [`GET ${base}/documents/doc-9/download`]: () => jsonResponse(404, { error: 'Document not found' }),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Descargar propuesta.pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo descargar "propuesta.pdf". El documento ya no existe');
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('hides the upload form once the project is past DRAFT/SUBMITTED, explaining why', async () => {
    openDocuments(
      { [`GET ${base}/documents`]: () => jsonResponse(200, { data: [makeDocument()] }) },
      owner,
      makeProject({ ownerId: owner.id, status: 'EVALUATED', allowedNextStatuses: [] }),
    );
    expect(await screen.findByRole('button', { name: 'Descargar propuesta.pdf' })).toBeInTheDocument();
    expect(screen.getByText(/Solo se pueden subir documentos mientras el proyecto está en Borrador o Enviado/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Archivo')).not.toBeInTheDocument();
  });

  it('JUDGE can list and download but has no upload form', async () => {
    openDocuments(
      { [`GET ${base}/documents`]: () => jsonResponse(200, { data: [makeDocument()] }) },
      makeUser('JUDGE'),
    );
    expect(await screen.findByRole('button', { name: 'Descargar propuesta.pdf' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Archivo')).not.toBeInTheDocument();
  });

  it('INVESTOR does not get the Documents tab and the documents endpoint is never called', async () => {
    const fetchMock = openDocuments({}, makeUser('INVESTOR'));
    expect(await screen.findByRole('tab', { name: 'Vista general' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Documentos' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, `GET ${base}/documents`)).toHaveLength(0);
  });
});
