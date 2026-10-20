import type { Role } from '../api/types';

export interface NavItem {
  to: string;
  label: string;
  /** true = active only on the exact path (so "/" is not active on every route). */
  end?: boolean;
}

export interface RoleView {
  dashboardTitle: string;
  dashboardIntro: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Whether the dashboard offers "Nuevo proyecto". Mirrors POST /projects (RESEARCHER, ADMINISTRATOR). */
  canCreate: boolean;
  /** Admin dashboards show a count per status. */
  showStatusCounts: boolean;
  nav: NavItem[];
}

const home = (label: string): NavItem => ({ to: '/', label, end: true });
const NEW_PROJECT: NavItem = { to: '/projects/new', label: 'Nuevo proyecto' };

/** What each role sees. Only a UI convenience: the backend authorizes every call. */
export const ROLE_VIEWS: Record<Role, RoleView> = {
  ADMINISTRATOR: {
    dashboardTitle: 'Todos los proyectos',
    dashboardIntro: 'Vista global de la plataforma con el conteo por estado.',
    emptyTitle: 'Aún no hay proyectos',
    emptyDescription: 'Cuando un investigador cree un proyecto aparecerá aquí.',
    canCreate: true,
    showStatusCounts: true,
    nav: [home('Proyectos'), NEW_PROJECT],
  },
  RESEARCHER: {
    dashboardTitle: 'Mis proyectos',
    dashboardIntro: 'Proyectos que diriges o en los que colaboras.',
    emptyTitle: 'Aún no hay proyectos',
    emptyDescription: 'Crea tu primer proyecto para empezar a subir documentos y sumar colaboradores.',
    canCreate: true,
    showStatusCounts: false,
    nav: [home('Mis proyectos'), NEW_PROJECT],
  },
  STUDENT: {
    dashboardTitle: 'Mis proyectos',
    dashboardIntro: 'Proyectos en los que colaboras.',
    emptyTitle: 'Aún no hay proyectos',
    emptyDescription: 'Un investigador debe agregarte como colaborador para que veas un proyecto aquí.',
    canCreate: false,
    showStatusCounts: false,
    nav: [home('Mis proyectos')],
  },
  JUDGE: {
    dashboardTitle: 'Proyectos asignados',
    dashboardIntro: 'Proyectos que se te asignaron para evaluar (solo lectura).',
    emptyTitle: 'Aún no hay proyectos asignados',
    emptyDescription: 'Un administrador debe asignarte proyectos para que aparezcan aquí.',
    canCreate: false,
    showStatusCounts: false,
    nav: [home('Proyectos asignados')],
  },
  INVESTOR: {
    dashboardTitle: 'Proyectos vinculados',
    dashboardIntro: 'Proyectos vinculados a tu cuenta de inversionista (solo lectura).',
    emptyTitle: 'Aún no hay proyectos vinculados',
    emptyDescription: 'Un administrador debe vincular proyectos a tu cuenta para que aparezcan aquí.',
    canCreate: false,
    showStatusCounts: false,
    nav: [home('Proyectos vinculados')],
  },
};
