"use client";

/**
 * SyncSheetsPanel — Panel de sincronización con Google Sheets
 *
 * Muestra el estado del último sync y permite disparar uno manual
 * via /api/sync-sheets (si existe). Si el endpoint no está disponible,
 * muestra un estado de "no configurado" amigable.
 */

import { useState } from "react";

type SyncStatus = "idle" | "syncing" | "ok" | "error" | "unconfigured";

export default function SyncSheetsPanel() {
  const [status,    setStatus]    = useState<SyncStatus>("idle");
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  const handleSync = async () => {
    setStatus("syncing");
    setErrMsg(null);
    try {
      const res = await fetch("/api/sync-sheets", { method: "POST" });
      if (res.status === 404) {
        setStatus("unconfigured");
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setLastSync(new Date());
      setStatus("ok");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Error desconocido");
      setStatus("error");
    }
  };

  const statusInfo: Record<SyncStatus, { icon: string; label: string; color: string }> = {
    idle:         { icon: "🔄", label: "Sin sincronizar",       color: "text-gray-400"  },
    syncing:      { icon: "⏳", label: "Sincronizando…",        color: "text-blue-600"  },
    ok:           { icon: "✅", label: "Sincronizado",           color: "text-green-600" },
    error:        { icon: "❌", label: "Error al sincronizar",   color: "text-red-600"   },
    unconfigured: { icon: "⚙️", label: "Sheets no configurado", color: "text-amber-600" },
  };

  const info = statusInfo[status];

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
      {/* Encabezado */}
      <div className="flex items-center gap-2">
        <span className="text-xl">📊</span>
        <div>
          <h3 className="font-bold text-sm text-[#1A1A1A]">Sincronización Google Sheets</h3>
          <p className="text-xs text-gray-400">
            Exporta lotes, movimientos y códigos al spreadsheet configurado
          </p>
        </div>
      </div>

      {/* Estado actual */}
      <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-xl border border-gray-100">
        <span className="text-lg">{info.icon}</span>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${info.color}`}>{info.label}</p>
          {lastSync && status === "ok" && (
            <p className="text-xs text-gray-400">
              Último sync: {lastSync.toLocaleTimeString("es-DO")}
            </p>
          )}
          {status === "unconfigured" && (
            <p className="text-xs text-gray-400">
              Agrega GOOGLE_SHEETS_ID en las variables de entorno
            </p>
          )}
          {errMsg && (
            <p className="text-xs text-red-500 mt-0.5">{errMsg}</p>
          )}
        </div>
      </div>

      {/* Botón de sync */}
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95
          disabled:opacity-50 flex items-center justify-center gap-2
          bg-[#1E8C3A] text-white hover:brightness-95"
      >
        {status === "syncing"
          ? <><span className="animate-spin">⏳</span> Sincronizando…</>
          : <><span>🔄</span> Sincronizar ahora</>
        }
      </button>

      {/* Info adicional */}
      <p className="text-xs text-gray-300 text-center leading-relaxed">
        La sincronización automática corre cada noche a las 23:00 h.<br />
        Usa este botón para forzar una sincronización manual.
      </p>
    </div>
  );
}
