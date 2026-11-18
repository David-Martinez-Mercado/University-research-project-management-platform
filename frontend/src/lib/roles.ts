import type { Role } from '../api/types';

export const ROLE_LABELS: Record<Role, string> = {
  USER: 'Usuario',
  JUDGE: 'Revisor de proyecto',
  INVESTOR: 'Revisor de avances',
  ADMINISTRATOR: 'Administrador',
};

/** Longer explanation of each role, for forms and help text. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  USER: 'Investigador o estudiante: crea proyectos y colabora en los de otras personas. Se registra solo.',
  JUDGE: 'Revisa y califica el proyecto completo. Lo crea un administrador.',
  INVESTOR: 'Revisa el avance de los proyectos vinculados, solo lectura. Lo crea un administrador.',
  ADMINISTRATOR: 'Gestiona usuarios, criterios, asignaciones y vínculos.',
};

/** Roles that review projects; only an administrator can create them. */
export const REVIEWER_ROLES: readonly Role[] = ['JUDGE', 'INVESTOR'];

/** Roles the backend lets through its role gate for the project write/collaborator endpoints. */
export const PROJECT_TEAM_ROLES: readonly Role[] = ['ADMINISTRATOR', 'USER'];
