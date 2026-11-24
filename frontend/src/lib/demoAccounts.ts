import type { Role } from '../api/types';

/**
 * Demo accounts for the quick-access buttons on the login page. They are created by `npm run db:seed-demo` in the backend
 * (same list in backend/scripts/seed-demo.ts). Development only: this module is imported lazily behind a build-time flag,
 * so a production build contains neither the buttons nor these passwords.
 */
export interface DemoAccount {
  role: Role;
  /** Short label on the button. */
  label: string;
  /** What the account is for. */
  description: string;
  email: string;
  password: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: 'ADMINISTRATOR',
    label: 'Administrador',
    description: 'Usuarios, criterios, asignaciones',
    email: 'admin@demo.edu',
    password: 'AdminDemo12345',
  },
  {
    role: 'USER',
    label: 'Usuario (dueño)',
    description: 'Investigador / estudiante',
    email: 'rosa@demo.edu',
    password: 'UsuarioDemo123',
  },
  {
    role: 'USER',
    label: 'Usuario (colaborador)',
    description: 'Investigador / estudiante',
    email: 'colaborador@demo.edu',
    password: 'ColabDemo12345',
  },
  {
    role: 'JUDGE',
    label: 'Revisor de proyecto',
    description: 'Califica el proyecto completo',
    email: 'juez@demo.edu',
    password: 'JuezDemo12345',
  },
  {
    role: 'INVESTOR',
    label: 'Revisor de avances',
    description: 'Sigue el avance, solo lectura',
    email: 'inv@demo.edu',
    password: 'Inversor12345',
  },
];
