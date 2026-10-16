import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/authenticate';

/**
 * Read scoping (BR-007 pattern). Returns a Prisma WHERE fragment that is ANDed into every
 * project query, so rows the caller may not see are never fetched from the database.
 * Unknown roles get a clause that matches nothing (default deny).
 *
 *  - ADMINISTRATOR: everything
 *  - RESEARCHER / STUDENT: projects they own or collaborate on
 *  - JUDGE: projects with a JudgeAssignment for them
 *  - INVESTOR: projects with an InvestorProjectLink for them
 */
export function visibleProjectsWhere(user: Pick<AuthUser, 'id' | 'role'>): Prisma.ProjectWhereInput {
  switch (user.role) {
    case 'ADMINISTRATOR':
      return {};
    case 'RESEARCHER':
    case 'STUDENT':
      return { OR: [{ ownerId: user.id }, { collaborators: { some: { userId: user.id } } }] };
    case 'JUDGE':
      return { judgeAssignments: { some: { judgeId: user.id } } };
    case 'INVESTOR':
      return { investorLinks: { some: { investorId: user.id } } };
    default:
      return { id: { in: [] } };
  }
}
