import { Link } from 'react-router-dom';
import type { Project } from '../api/types';
import { formatDate } from '../lib/labels';
import { StatusBadge } from './badges';
import { Badge, Card } from './ui';

/** Renders what the backend returned for the caller; it never filters or re-scopes rows. */
export function ProjectList({ projects, currentUserId }: { projects: Project[]; currentUserId: string }) {
  return (
    <ul className="space-y-3">
      {projects.map((project) => (
        <li key={project.id}>
          <Card className="border-l-4 border-l-brand-500 transition-shadow hover:shadow-md">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-base font-semibold">
                  <Link
                    to={`/projects/${project.id}`}
                    className="text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    {project.title}
                  </Link>
                </h3>
                {project.summary && (
                  <p className="mt-1 line-clamp-2 break-words text-sm text-slate-600">{project.summary}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {project.ownerId === currentUserId && <Badge tone="info">Dueño</Badge>}
                <StatusBadge status={project.status} />
              </div>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              {project.researchArea && (
                <div className="flex gap-1">
                  <dt>Área:</dt>
                  <dd className="text-slate-700">{project.researchArea}</dd>
                </div>
              )}
              <div className="flex gap-1">
                <dt>Actualizado:</dt>
                <dd className="text-slate-700">{formatDate(project.updatedAt)}</dd>
              </div>
            </dl>
          </Card>
        </li>
      ))}
    </ul>
  );
}
