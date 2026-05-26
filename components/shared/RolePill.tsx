"use client";

/**
 * RolePill — pastilla moderna de rol para los headers de todos los dashboards.
 * Uso:
 *   <RolePill rol="admin" nombre={profile?.nombre} />
 */

import { useEffect, useState } from "react";

type Rol = "admin" | "despachador" | "encargado" | "chofer";

const ROL_CONFIG: Record<Rol, { icon: string; label: string; pill: string; dot: string }> = {
  admin:       { icon: "🛡️",  label: "Administrador", pill: "bg-[#F5C800]/20 border-[#F5C800]/40 text-[#F5C800]",  dot: "bg-[#F5C800]" },
  despachador: { icon: "🚛",  label: "Despachador",   pill: "bg-[#D42B2B]/20 border-[#D42B2B]/40 text-[#FF8080]",  dot: "bg-[#D42B2B]" },
  encargado:   { icon: "🏭",  label: "Encargado",     pill: "bg-[#1E8C3A]/20 border-[#1E8C3A]/40 text-[#5de88a]",  dot: "bg-[#1E8C3A]" },
  chofer:      { icon: "🏍️", label: "Chofer",        pill: "bg-white/10    border-white/20       text-white/80",   dot: "bg-white/60"  },
};

interface Props {
  rol: Rol;
  nombre?: string;
  /** Muestra el nombre encima de la pastilla (por defecto true en sm+) */
  showNombre?: boolean;
}

export default function RolePill({ rol, nombre, showNombre = true }: Props) {
  const cfg = ROL_CONFIG[rol] ?? ROL_CONFIG["chofer"];

  // Indicador PWA instalada
  const [pwaInstalada, setPwaInstalada] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(display-mode: standalone)");
    setPwaInstalada(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPwaInstalada(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
      {showNombre && nombre && (
        <p className="text-sm font-bold leading-tight truncate max-w-[130px] hidden sm:block text-white">
          {nombre}
        </p>
      )}
      <span
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px]
          font-black border backdrop-blur-sm whitespace-nowrap transition-all
          ${cfg.pill}`}
      >
        {/* Dot de estado online */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot} ${pwaInstalada ? "animate-pulse" : ""}`} />
        <span>{cfg.icon}</span>
        <span className="hidden sm:inline">{cfg.label}</span>
        {pwaInstalada && (
          <span className="hidden sm:inline text-[8px] opacity-70 ml-0.5">PWA</span>
        )}
      </span>
    </div>
  );
}
