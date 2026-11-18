import type { Collaborator, Project, Role } from '../../api/types';
import type { AsyncState } from '../../lib/useAsync';

/** What every workspace tab needs to know about the project and the caller. */
export interface WorkspaceContext {
  project: Project;
  onProjectChange: (project: Project) => void;
  role: Role;
  userId: string;
  /**
   * Owner or administrator: submits the project and controls collaborators and their view/edit permission. Derived from data the backend returned and used only
   * to decide which controls to show; the backend re-checks every write.
   */
  canManage: boolean;
  /** Owner, EDITOR collaborator or administrator: may change content, documents and progress. */
  canEdit: boolean;
  /** Undefined state for roles that cannot read collaborators (JUDGE, INVESTOR). */
  collaborators: AsyncState<Collaborator[]> | null;
}
