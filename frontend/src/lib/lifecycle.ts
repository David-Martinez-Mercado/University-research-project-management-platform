import type { ProjectStatus, Role } from '../api/types';

/**
 * Client-side mirror of the backend transition table (backend/src/projects/projects.lifecycle.ts),
 * used ONLY to decide which buttons to offer. The backend stays the authority: it answers 409 for an
 * invalid pair and 403 for the wrong actor, and the UI shows those messages.
 */
export interface TransitionAction {
  from: ProjectStatus;
  to: ProjectStatus;
  /** MANAGER = owner, LEAD collaborator or administrator; ADMIN = administrator only. */
  actor: 'MANAGER' | 'ADMIN';
  label: string;
}

export const TRANSITION_ACTIONS: readonly TransitionAction[] = [
  { from: 'DRAFT', to: 'SUBMITTED', actor: 'MANAGER', label: 'Enviar a revisión' },
  { from: 'SUBMITTED', to: 'DRAFT', actor: 'MANAGER', label: 'Retirar a borrador' },
  { from: 'SUBMITTED', to: 'UNDER_EVALUATION', actor: 'ADMIN', label: 'Iniciar evaluación' },
  { from: 'UNDER_EVALUATION', to: 'EVALUATED', actor: 'ADMIN', label: 'Cerrar evaluación' },
  { from: 'EVALUATED', to: 'ARCHIVED', actor: 'ADMIN', label: 'Archivar' },
];

/** Actions to offer: the backend's allowedNextStatuses, narrowed by what this caller may do. */
export function offeredActions(
  from: ProjectStatus,
  allowedNext: readonly ProjectStatus[],
  role: Role,
  canManage: boolean,
): TransitionAction[] {
  return TRANSITION_ACTIONS.filter((a) => {
    if (a.from !== from || !allowedNext.includes(a.to)) return false;
    return a.actor === 'ADMIN' ? role === 'ADMINISTRATOR' : canManage;
  });
}
