import type { Role } from '../api/types';

export const ROLE_LABELS: Record<Role, string> = {
  INVESTOR: 'Inversionista',
  RESEARCHER: 'Investigador',
  JUDGE: 'Juez',
  STUDENT: 'Estudiante',
  ADMINISTRATOR: 'Administrador',
};

/** Roles the backend lets through its role gate for the project write/collaborator endpoints. */
export const PROJECT_TEAM_ROLES: readonly Role[] = ['ADMINISTRATOR', 'RESEARCHER', 'STUDENT'];
