"use client";

// Banner fijo para la Bandeja de Despacho — a propósito NO reusa AvisoAreaBanner:
// ese componente se descarta para siempre en el dispositivo al tocar OK (localStorage),
// lo cual rompería el requisito de "no desaparece sola" de un ticket con estado propio.
// Este banner solo depende del conteo real de pendientes: desaparece cuando el
// Despachador de verdad marca las notas como leídas/resueltas, no antes.

interface Props {
  pendientes: number;
  onVerBandeja: () => void;
}

export default function BandejaDespachoBanner({ pendientes, onVerBandeja }: Props) {
  if (pendientes <= 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-white px-4 py-2.5 shadow-lg flex items-center justify-between gap-3">
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
