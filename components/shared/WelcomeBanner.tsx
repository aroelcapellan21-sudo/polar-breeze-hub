"use client";

import { useState, useEffect } from "react";

interface Props {
  nombre:  string;
  area:    string;   // "Hub Admin" | "Despacho" | "Supervisor" | "Ruta"
  acento?: string;   // color del badge de área (hex)
}

export default function WelcomeBanner({ nombre, area, acento = "#F5C800" }: Props) {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hora  = ahora?.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }) ?? "--:--";
  const fecha = ahora?.toLocaleDateString("es-DO", {
    weekday: "short", day: "numeric", month: "short",
  }) ?? "";

  return (
    <div className="bg-white border-b border-gray-100 px-4 py-2.5">
      <div className="flex items-center justify-between gap-4">

        {/* ── Izquierda: saludo + área ── */}
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">
            Hola, <span className="text-[#1A1A1A]">{nombre || "—"}</span> 👋
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide"
              style={{ background: `${acento}25`, color: acento === "#F5C800" ? "#7a6200" : acento }}
            >
              {area}
            </span>
          </div>
        </div>

        {/* ── Derecha: hora + fecha ── */}
        <div className="text-right flex-shrink-0">
          <p className="text-base font-black tabular-nums text-[#1A1A1A] leading-tight">{hora}</p>
          <p className="text-[10px] text-gray-400 capitalize leading-tight">{fecha}</p>
        </div>

      </div>
    </div>
  );
}
