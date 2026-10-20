import { ApiError } from '../api/client';
import { FIELD_LABELS, STATUS_LABELS } from './labels';

export type ErrorContext =
  | 'load'
  | 'project-save'
  | 'project-create'
  | 'status'
  | 'collaborator-add'
  | 'collaborator-remove'
  | 'document-upload'
  | 'document-download';

export const MAX_UPLOAD_MB = 10;
export const UPLOAD_CLOSED =
  'Solo se pueden subir documentos mientras el proyecto está en Borrador o Enviado.';

const serverDetail = (err: ApiError) => (err.body.error ? ` (${err.body.error})` : '');

/**
 * Turns an API failure into Spanish text for the user. The backend decides; this only translates
 * its status code (and the structured extras: `missing`, `from`/`to`/`allowed`) into a clear message.
 */
export function describeError(err: unknown, context: ErrorContext = 'load'): string {
  if (!(err instanceof ApiError)) return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  const { status, body } = err;

  if (status === 0) return 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (status === 429) return 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.';
  if (status >= 500) return 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.';

  switch (context) {
    case 'status':
      if (status === 403) return 'No tienes permiso para cambiar el estado de este proyecto.';
      if (status === 404) return 'El proyecto ya no existe o no tienes acceso a él.';
      if (status === 409) {
        if (body.from && body.to) {
          const allowed = body.allowed?.length
            ? ` Desde ${STATUS_LABELS[body.from]} solo se permite: ${body.allowed.map((s) => STATUS_LABELS[s]).join(', ')}.`
            : ` ${STATUS_LABELS[body.from]} es un estado final.`;
          return `No se puede pasar de ${STATUS_LABELS[body.from]} a ${STATUS_LABELS[body.to]}.${allowed}`;
        }
        return 'El estado del proyecto cambió mientras tanto. Recarga la página e inténtalo de nuevo.';
      }
      if (status === 422) {
        const missing = (body.missing ?? []).map((f) => FIELD_LABELS[f] ?? f);
        return missing.length
          ? `Faltan ${missing.join(' y ')} para enviar el proyecto. Complétalos en la edición e inténtalo de nuevo.`
          : 'El proyecto está incompleto para esta acción.';
      }
      break;
    case 'project-save':
      if (status === 400) return 'Revisa los campos marcados.';
      if (status === 403) return 'No tienes permiso para editar este proyecto.';
      if (status === 404) return 'El proyecto ya no existe o no tienes acceso a él.';
      if (status === 409) return 'El proyecto ya no está en borrador, por lo que no se puede editar.';
      break;
    case 'project-create':
      if (status === 400) return 'Revisa los campos marcados.';
      if (status === 403) return 'Tu rol no puede crear proyectos.';
      break;
    case 'collaborator-add':
      if (status === 400) return 'Revisa el identificador de usuario y el rol.';
      if (status === 403) return 'No tienes permiso para agregar colaboradores a este proyecto.';
      if (status === 404) return 'No existe un usuario activo con ese identificador.';
      if (status === 409) return 'Ese usuario ya es colaborador del proyecto (o es el dueño, que ya es líder).';
      if (status === 422) return 'Solo usuarios con rol Investigador o Estudiante pueden ser colaboradores.';
      break;
    case 'collaborator-remove':
      if (status === 403) return 'No tienes permiso para quitar colaboradores de este proyecto.';
      if (status === 404) return 'Ese colaborador ya no está en el proyecto.';
      if (status === 409) return 'El dueño del proyecto no se puede quitar.';
      break;
    case 'document-upload':
      if (status === 413) return `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_MB} MB).`;
      if (status === 415) {
        return `El tipo de archivo no es compatible, o su contenido no coincide con su extensión. Formatos permitidos: PDF, DOCX, TXT y MD, hasta ${MAX_UPLOAD_MB} MB.`;
      }
      if (status === 400) {
        return `El servidor rechazó el archivo (por ejemplo, está vacío o la solicitud está mal formada).${serverDetail(err)}`;
      }
      if (status === 403) return 'No tienes permiso para subir documentos a este proyecto.';
      if (status === 404) return 'El proyecto ya no existe o no tienes acceso a él.';
      if (status === 409) return UPLOAD_CLOSED;
      break;
    case 'document-download':
      if (status === 403) return 'No tienes permiso para descargar este documento.';
      if (status === 404) return 'El documento ya no existe o no tienes acceso a él.';
      break;
    default:
      if (status === 403) return 'No tienes permiso para ver este contenido.';
      if (status === 404) return 'No se encontró el contenido solicitado, o no tienes acceso a él.';
  }
  return `No se pudo completar la acción.${serverDetail(err)}`;
}

/** Maps the 400 `details` of a validation failure onto field names. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (err instanceof ApiError && err.status === 400) {
    for (const issue of err.body.details ?? []) {
      fields[issue.path || '_'] ??= translateIssue(issue.message);
    }
  }
  return fields;
}

function translateIssue(message: string): string {
  if (/at least 1 character/i.test(message) || /required/i.test(message)) return 'Este campo es obligatorio.';
  const max = /at most (\d+) character/i.exec(message);
  if (max) return `Máximo ${max[1]} caracteres.`;
  if (/invalid uuid/i.test(message)) return 'Debe ser un identificador UUID válido.';
  return message;
}
