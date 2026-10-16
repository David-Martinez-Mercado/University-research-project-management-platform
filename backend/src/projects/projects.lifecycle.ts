import type { ProjectStatus } from '@prisma/client';

/**
 * Who may perform a transition:
 *  - MANAGER: the project owner, a LEAD collaborator, or an ADMINISTRATOR.
 *  - ADMIN:   ADMINISTRATOR only.
 */
export type TransitionActor = 'MANAGER' | 'ADMIN';

export interface TransitionRule {
  from: ProjectStatus;
  to: ProjectStatus;
  actor: TransitionActor;
  description: string;
}

/** The ONLY place that defines the project lifecycle. Anything not listed is rejected (409). */
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'DRAFT', to: 'SUBMITTED', actor: 'MANAGER', description: 'Submit for review' },
  { from: 'SUBMITTED', to: 'DRAFT', actor: 'MANAGER', description: 'Withdraw back to draft' },
  { from: 'SUBMITTED', to: 'UNDER_EVALUATION', actor: 'ADMIN', description: 'Start evaluation' },
  { from: 'UNDER_EVALUATION', to: 'EVALUATED', actor: 'ADMIN', description: 'Close evaluation' },
  { from: 'EVALUATED', to: 'ARCHIVED', actor: 'ADMIN', description: 'Archive' },
];

export function findTransition(from: ProjectStatus, to: ProjectStatus): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function allowedNextStatuses(from: ProjectStatus): ProjectStatus[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

/** Minimum content a project must have before it can leave DRAFT. Returns the missing fields. */
export function missingForSubmission(p: { title: string; description: string | null }): string[] {
  const missing: string[] = [];
  if (!p.title?.trim()) missing.push('title');
  if (!p.description?.trim()) missing.push('description');
  return missing;
}
