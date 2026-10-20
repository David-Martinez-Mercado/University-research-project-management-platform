/** Always visible while VITE_USE_MOCKS=true so mocked data can never be mistaken for real data. */
export function MockBanner() {
  return (
    <div role="status" className="bg-amber-400 px-4 py-1.5 text-center text-sm font-medium text-amber-950">
      API SIMULADA: los documentos (subir, listar, descargar) son simulados en memoria porque su backend aún no está
      disponible. El resto (sesión, proyectos, colaboradores) usa el backend real.
    </div>
  );
}
