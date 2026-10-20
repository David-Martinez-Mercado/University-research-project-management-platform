/**
 * Conflict-of-interest rule for judge assignment (FR-010). Pure functions, no I/O, so the
 * rule is trivially testable and the service only has to feed it fresh data.
 *
 * A judge conflicts with a project if they OWN it, COLLABORATE on it, or share its
 * AFFILIATION. The rule FAILS CLOSED: if either affiliation is missing the check cannot
 * be performed, so the assignment is rejected (never "warn and allow").
 */

export type CoiReasonCode =
  | 'JUDGE_IS_OWNER'
  | 'JUDGE_IS_COLLABORATOR'
  | 'SAME_AFFILIATION'
  | 'JUDGE_AFFILIATION_MISSING'
  | 'PROJECT_AFFILIATION_MISSING';

export interface CoiReason {
  code: CoiReasonCode;
  message: string;
}

export interface CoiInput {
  judge: { id: string; affiliation: string | null };
  project: { ownerId: string; affiliation: string | null };
  collaboratorIds: readonly string[];
}

export interface CoiResult {
  /** Real conflicts. */
  conflicts: CoiReason[];
  /** Missing data that makes the check impossible (treated as a rejection). */
  unverifiable: CoiReason[];
}

/**
 * Case-, whitespace- and accent-insensitive form of an affiliation; null when blank.
 * Accent stripping makes the comparison MORE likely to match, which is the safe direction.
 */
export function normalizeAffiliation(value: string | null | undefined): string | null {
  if (!value) return null;
  const n = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return n.length > 0 ? n : null;
}

export function evaluateConflictOfInterest({ judge, project, collaboratorIds }: CoiInput): CoiResult {
  const conflicts: CoiReason[] = [];
  const unverifiable: CoiReason[] = [];

  if (project.ownerId === judge.id) {
    conflicts.push({ code: 'JUDGE_IS_OWNER', message: 'the judge is the owner of this project' });
  }
  if (collaboratorIds.includes(judge.id)) {
    conflicts.push({ code: 'JUDGE_IS_COLLABORATOR', message: 'the judge is a collaborator on this project' });
  }

  const judgeAff = normalizeAffiliation(judge.affiliation);
  const projectAff = normalizeAffiliation(project.affiliation);
  if (!judgeAff) {
    unverifiable.push({
      code: 'JUDGE_AFFILIATION_MISSING',
      message: 'the judge has no affiliation on record; an administrator must fill it in (PUT /users/:id) before assigning',
    });
  }
  if (!projectAff) {
    unverifiable.push({
      code: 'PROJECT_AFFILIATION_MISSING',
      message: 'the project has no affiliation on record; it must be filled in (PUT /projects/:id) before assigning a judge',
    });
  }
  if (judgeAff && projectAff && judgeAff === projectAff) {
    conflicts.push({
      code: 'SAME_AFFILIATION',
      message: 'the judge and the project share the same affiliation',
    });
  }

  return { conflicts, unverifiable };
}
