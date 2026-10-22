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
  | 'document-download'
  | 'user-save'
  | 'criterion-save'
  | 'assignment-create'
  | 'assignment-delete'
  | 'ai-ask'
  | 'evaluation-save'
  | 'milestone'
  | 'report'
  | 'investor-link';

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
  // A 503 from the assistant or the report generator has its own, more useful message below.
  if (status >= 500 && context !== 'ai-ask' && context !== 'report') return 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.';

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
      if (status === 400) return 'Revisa el correo y el rol.';
      if (status === 403) return 'No tienes permiso para agregar colaboradores a este proyecto.';
      // The server answers identically for unknown, inactive and wrong-role emails (no enumeration).
      if (status === 404) return 'No se encontró un usuario elegible con ese correo. Debe ser un Investigador o Estudiante activo.';
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
    case 'user-save':
      if (status === 400) return 'Revisa los campos marcados. La contraseña debe tener al menos 10 caracteres.';
      if (status === 409) return 'Ya existe una cuenta con ese correo electrónico.';
      if (status === 404) return 'El usuario ya no existe.';
      if (status === 403) return 'No tienes permiso para administrar usuarios.';
      break;
    case 'criterion-save':
      if (status === 400) return 'Revisa los campos marcados (puntaje máximo 1-100, peso entre 0.01 y 99.99).';
      if (status === 404) return 'El criterio ya no existe.';
      break;
    case 'assignment-create': {
      if (status === 422 && Array.isArray((body as { reasons?: Array<{ message: string }> }).reasons)) {
        const reasons = (body as { reasons: Array<{ message: string }> }).reasons.map((r) => r.message).join(' ');
        return `No se puede asignar a este juez: ${reasons}`;
      }
      if (status === 422) return body.error ?? 'No se puede asignar a este juez a este proyecto.';
      if (status === 409) return 'Ese juez ya está asignado al proyecto, o el proyecto no está listo para evaluación (debe estar Enviado o En evaluación).';
      if (status === 404) return 'El proyecto o el juez ya no existe.';
      break;
    }
    case 'assignment-delete':
      if (status === 409) return 'Esta asignación ya tiene evaluaciones registradas y no se puede quitar.';
      if (status === 404) return 'La asignación ya no existe.';
      break;
    case 'ai-ask':
      if (status === 503) return 'El asistente de IA no está disponible temporalmente. Inténtalo de nuevo en unos minutos.';
      if (status === 400) return 'Escribe una pregunta de al menos 3 caracteres.';
      if (status === 404) return 'El proyecto ya no existe o no tienes acceso a él.';
      break;
    case 'evaluation-save': {
      const extra = body as { code?: string; missing?: Array<{ name: string }> };
      if (status === 422 && extra.code === 'INCOMPLETE_EVALUATION') {
        const names = (extra.missing ?? []).map((m) => `«${m.name}»`).join(', ');
        return names ? `Falta calificar: ${names}. Guarda un borrador o completa todos los criterios.` : 'Todos los criterios deben tener calificación.';
      }
      if (status === 422) return body.error ?? 'Revisa las calificaciones.';
      if (status === 403) return 'No puedes evaluar este proyecto: eres autor o colaborador del mismo.';
      if (status === 409) return 'Este proyecto ya no admite cambios en tu evaluación (no está en evaluación o ya la enviaste).';
      if (status === 404) return 'El proyecto no está asignado a ti.';
      break;
    }
    case 'milestone':
      if (status === 400) return 'Revisa el título y la fecha (AAAA-MM-DD).';
      if (status === 403) return 'Solo el equipo del proyecto puede actualizar el avance.';
      if (status === 409) return 'El avance no se puede cambiar cuando el proyecto ya está en evaluación.';
      if (status === 404) return 'El hito ya no existe.';
      break;
    case 'report':
      if (status === 503) return 'No se pudo generar el reporte. Inténtalo de nuevo.';
      if (status === 403 || status === 404) return 'No tienes acceso al reporte de este proyecto.';
      break;
    case 'investor-link':
      if (status === 409) return 'Ese inversionista ya está vinculado a ese proyecto.';
      if (status === 422) return body.error ?? 'El usuario elegido no es un inversionista activo.';
      if (status === 404) return 'El inversionista o el proyecto ya no existe.';
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
