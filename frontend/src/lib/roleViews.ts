import type { Role } from '../api/types';
import type { IconName } from '../components/ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  /** true = active only on the exact path (so "/" is not active on every route). */
  end?: boolean;
  icon?: IconName;
}

export interface RoleView {
  dashboardTitle: string;
  dashboardIntro: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Whether the dashboard offers "Nuevo proyecto". Mirrors POST /projects (USER, ADMINISTRATOR). */
  canCreate: boolean;
  /** Admin dashboards show a count per status. */
  showStatusCounts: boolean;
  nav: NavItem[];
}

const home = (label: string): NavItem => ({ to: '/', label, end: true, icon: 'folder' });
const NOTIFICATIONS: NavItem = { to: '/notifications', label: 'Notificaciones', icon: 'bell' };
const NEW_PROJECT: NavItem = { to: '/projects/new', label: 'Nuevo proyecto', icon: 'plus' };

/** What each role sees. Only a UI convenience: the backend authorizes every call. */
export const ROLE_VIEWS: Record<Role, RoleView> = {
  ADMINISTRATOR: {
    dashboardTitle: 'Todos los proyectos',
    dashboardIntro: 'Vista global de la plataforma con el conteo por estado.',
    emptyTitle: 'Aún no hay proyectos',
    emptyDescription: 'Cuando un investigador cree un proyecto aparecerá aquí.',
    canCreate: true,
    showStatusCounts: true,
    nav: [
      home('Proyectos'),
      NEW_PROJECT,
      { to: '/admin/users', label: 'Usuarios', icon: 'users' },
      { to: '/admin/criteria', label: 'Criterios', icon: 'clipboard' },
      { to: '/admin/assignments', label: 'Asignación de jueces', icon: 'gavel' },
      { to: '/admin/investors', label: 'Inversionistas', icon: 'chart' },
      { to: '/admin/ai', label: 'Actividad de IA', icon: 'search' },
      NOTIFICATIONS,
    ],
  },
  USER: {
    dashboardTitle: 'Mis proyectos',
    dashboardIntro: 'Proyectos que creaste o en los que colaboras.',
    emptyTitle: 'Aún no hay proyectos',
    emptyDescription: 'Crea tu primer proyecto o pide a alguien que te agregue como colaborador.',
    canCreate: true,
    showStatusCounts: false,
    nav: [home('Mis proyectos'), NEW_PROJECT, NOTIFICATIONS],
  },
  JUDGE: {
    dashboardTitle: 'Proyectos asignados',
    dashboardIntro: 'Proyectos que se te asignaron para revisar y calificar.',
    emptyTitle: 'Aún no hay proyectos asignados',
    emptyDescription: 'Un administrador debe asignarte proyectos para que aparezcan aquí.',
    canCreate: false,
    showStatusCounts: false,
    nav: [home('Proyectos asignados'), NOTIFICATIONS],
  },
  INVESTOR: {
    dashboardTitle: 'Proyectos vinculados',
    dashboardIntro: 'Proyectos vinculados a tu cuenta de inversionista (solo lectura).',
    emptyTitle: 'Aún no hay proyectos vinculados',
    emptyDescription: 'Un administrador debe vincular proyectos a tu cuenta para que aparezcan aquí.',
    canCreate: false,
    showStatusCounts: false,
    nav: [home('Proyectos vinculados'), NOTIFICATIONS],
  },
};
