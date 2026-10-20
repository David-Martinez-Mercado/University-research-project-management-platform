import { EventEmitter } from 'node:events';

/**
 * SHARED CONTRACT between the documents module (emits) and the AI ingestion module (listens).
 * The documents module emits `uploaded` AFTER the document row is committed and the bytes are
 * saved. Listeners must never throw into the emitter: they handle their own errors.
 */
export interface DocumentUploadedEvent {
  documentId: string;
  projectId: string;
}

export const documentEvents = new EventEmitter();
export const DOCUMENT_UPLOADED = 'uploaded';

export function emitDocumentUploaded(event: DocumentUploadedEvent): void {
  documentEvents.emit(DOCUMENT_UPLOADED, event);
}
