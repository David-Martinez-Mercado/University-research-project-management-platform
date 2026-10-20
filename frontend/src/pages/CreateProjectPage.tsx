import { Navigate, useNavigate } from 'react-router-dom';
import { createProject } from '../api/projects';
import { useAuth } from '../auth/AuthContext';
import { ProjectForm, toCreatePayload } from '../components/ProjectForm';
import { RoleShell } from '../components/RoleShell';
import { Card } from '../components/ui';
import { ROLE_VIEWS } from '../lib/roleViews';

export function CreateProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  // UI convenience only: POST /projects still answers 403 to any other role.
  if (!ROLE_VIEWS[user.role].canCreate) return <Navigate to="/" replace />;

  return (
    <RoleShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">Nuevo proyecto</h1>
        <Card description="El proyecto se crea como borrador. Podrás editarlo, subir documentos y enviarlo a revisión después.">
          <ProjectForm
            submitLabel="Crear proyecto"
            errorContext="project-create"
            onCancel={() => navigate('/')}
            onSubmit={async (values) => {
              const project = await createProject(toCreatePayload(values));
              navigate(`/projects/${project.id}`);
            }}
          />
        </Card>
      </div>
    </RoleShell>
  );
}
