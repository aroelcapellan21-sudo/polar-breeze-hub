"use client";

// Banner para la Bandeja de Despacho — a propósito NO reusa AvisoAreaBanner:
// ese componente se descarta para siempre en el dispositivo al tocar OK (localStorage),
// lo cual rompería el requisito de "no desaparece sola" de un ticket con estado propio.
// Este banner solo depende del conteo real de pendientes: desaparece cuando el
// Despachador de verdad marca las notas como leídas/resueltas, no antes.
//
// Bug encontrado y corregido (2026-07-10, verificado con Playwright): la versión
// original usaba `position:fixed` a todo lo ancho arriba de la página — eso tapaba
// físicamente el botón ☰ del menú del header (mismo rango de coordenadas), así que
// el Despachador no podía abrir el menú para llegar al tab Bandeja por el camino
// normal mientras hubiera algo pendiente (que es siempre que el banner se muestra).
// Ahora es un bloque normal en el flujo (mismo patrón que WelcomeBanner.tsx),
// montado DESPUÉS del header — nunca compite por el mismo espacio.

interface Props {
  pendientes: number;
  onVerBandeja: () => void;
}

export default function BandejaDespachoBanner({ pendientes, onVerBandeja }: Props) {
  if (pendientes <= 0) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3">
      <span className="text-sm font-bold">
        📨 {pendientes} nota{pendientes !== 1 ? "s" : ""} pendiente{pendientes !== 1 ? "s" : ""} en la Bandeja
      </span>
      <button
        onClick={onVerBandeja}
        className="flex-shrink-0 bg-white text-amber-700 font-bold rounded-lg px-4 py-1.5 text-sm active:scale-95 transition-all"
      >
        Ver bandeja
      </button>
    </div>
  );
}
