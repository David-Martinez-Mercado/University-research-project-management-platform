import { EmptyState } from '../ui';

/** Honest placeholder for tabs scheduled for a later sprint; shows no fake data. */
export function PlaceholderTab({ name, description }: { name: string; description: string }) {
  return (
    <EmptyState
      title={`${name}: disponible en una semana posterior`}
      description={`${description} Esta sección está programada para la semana 4 y todavía no está implementada.`}
    />
  );
}
