"use client";

/**
 * SyncSheetsPanel — Panel de sincronización con Google Sheets
 *
 * Muestra el estado de configuración y permite:
 * 1. Exportar CSV (siempre disponible)
 * 2. Sincronizar a Google Sheets (requiere env vars en Vercel)
 *
 * Se usa en PolarBreezeWeight y en el Dashboard Encargado (tab Stock).
 */

import { useState, useEffect } from "react";

interface SyncStatus {
  configurado: boolean;
  sheetsId:    string | null;
  mensaje:     string;
}

interface SyncSheetsProps {
  adminApiKey?: string;     // Bearer token para la ruta POST (opcional)
  compact?:    boolean;     // vista compacta sin descripción
}

export default function SyncSheetsPanel({ adminApiKey, compact }: SyncSheetsProps) {
  const [status,    setStatus]    = useState<SyncStatus | null>(null);
  const [syncing,   setSyncing]   = useState(false);
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [syncMsg,   setSyncMsg]   = useState<{ tipo: "ok" | "err"; texto: string } | null>(null);
  const [checking,  setChecking]  = useState(true);

  useEffect(() => {
    fetch("/api/sync-sheets")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus({ configurado: false, sheetsId: null, mensaje: "No se pudo verificar el estado." }))
      .finally(() => setChecking(false));
  }, []);

  const exportCSV = () => {
    window.open("/api/export-codigos", "_blank");
  };

  const syncSheets = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (adminApiKey) headers["Authorization"] = `Bearer ${adminApiKey}`;

      const res  = await fetch("/api/sync-sheets", { method: "POST", headers });
      const data = await res.json();

      if (data.ok) {
        setLastSync(new Date());
        setSyncMsg({ tipo: "ok", texto: data.mensaje });
      } else {
        setSyncMsg({ tipo: "err", texto: data.error ?? "Error al sincronizar" });
      }
    } catch {
      setSyncMsg({ tipo: "err", texto: "Error de conexión" });
    } finally {
      setSyncing(false);
    }
  };

  if (checking) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <p className="text-xs text-gray-400 animate-pulse">Verificando configuración…</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={exportCSV}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700
            hover:bg-gray-200 active:scale-95 transition-all font-medium"
        >
          📥 Exportar CSV
        </button>
        {status?.configurado && (
          <button
            onClick={syncSheets}
            disabled={syncing}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#1E8C3A] text-white
              hover:bg-green-700 active:scale-95 transition-all font-medium disabled:opacity-60"
          >
            {syncing ? "Sincronizando…" : "🔄 Sync Sheets"}
          </button>
        )}
        {lastSync && (
          <span className="text-xs text-green-600 font-medium">
            ✅ {lastSync.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {syncMsg && (
          <span className={`text-xs font-medium ${syncMsg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>
            {syncMsg.texto}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xl">📊</span>
        <div>
          <p className="font-bold text-[#1A1A1A] text-sm">Sincronización Google Sheets</p>
          <p className="text-xs text-gray-400">
            Base de códigos compartida entre Weight y SPIKINSCAN
          </p>
        </div>
      </div>

      {/* Estado */}
      <div className={`rounded-xl px-4 py-3 text-sm ${
        status?.configurado
          ? "bg-green-50 border border-green-100 text-green-800"
          : "bg-yellow-50 border border-yellow-100 text-yellow-800"
      }`}>
        <div className="flex items-center gap-2">
          <span>{status?.configurado ? "✅" : "⚠️"}</span>
          <p className="text-xs font-medium">{status?.mensaje}</p>
        </div>
        {status?.sheetsId && (
          <p className="text-xs mt-1 text-gray-400 font-mono">{status.sheetsId}</p>
        )}
      </div>

      {/* Última sincronización */}
      {lastSync && (
        <div className="text-xs text-green-600 font-medium bg-green-50 rounded-lg px-3 py-2">
          ✅ Última sync: {lastSync.toLocaleString("es-DO", {
            day: "2-digit", month: "short",
            hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}

      {/* Mensaje de resultado */}
      {syncMsg && (
        <div className={`text-xs font-medium rounded-lg px-3 py-2 ${
          syncMsg.tipo === "ok"
            ? "bg-green-50 text-green-700"
            : "bg-red-50 text-red-700"
        }`}>
          {syncMsg.texto}
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-2">
        {status?.configurado && (
          <button
            onClick={syncSheets}
            disabled={syncing}
            className="w-full py-3 rounded-xl bg-[#1E8C3A] text-white text-sm font-bold
              hover:bg-green-700 active:scale-95 transition-all disabled:opacity-60
              flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <span className="animate-spin">🔄</span> Sincronizando…
              </>
            ) : (
              "🔄 Sincronizar ahora → Sheets"
            )}
          </button>
        )}

        <button
          onClick={exportCSV}
          className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-gray-700 text-sm font-semibold
            hover:bg-gray-50 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          📥 Descargar CSV
        </button>

        {!status?.configurado && (
          <div className="text-xs text-gray-400 text-center leading-relaxed">
            Para activar sync automático, configura<br/>
            <span className="font-mono">GOOGLE_SHEETS_ID</span>,{" "}
            <span className="font-mono">GOOGLE_SERVICE_ACCOUNT_EMAIL</span> y<br/>
            <span className="font-mono">GOOGLE_PRIVATE_KEY</span> en Vercel.
          </div>
        )}
      </div>
    </div>
  );
}
