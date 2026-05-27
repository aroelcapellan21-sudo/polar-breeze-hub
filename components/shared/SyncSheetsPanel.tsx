"use client";

/**
 * SyncSheetsPanel — Sincronización Firestore → Google Sheets
 *
 * Sincroniza:
 *  · Tab "Códigos"       — catálogo de productos (codigos_cajas)
 *  · Tab "Lotes Weight"  — recepciones de mercancía
 *  · Tab "Movimientos"   — entradas/salidas del loker
 *
 * Requiere en Vercel:
 *   GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 */

import { useState } from "react";

type SyncStatus = "idle" | "syncing" | "ok" | "error" | "unconfigured";

interface SyncResult {
  codigos:     number;
  lotes:       number;
  movimientos: number;
  ms:          number;
  syncedAt:    string;
}

export default function SyncSheetsPanel() {
  const [status,   setStatus]   = useState<SyncStatus>("idle");
  const [result,   setResult]   = useState<SyncResult | null>(null);
  const [errMsg,   setErrMsg]   = useState<string | null>(null);
  const [missing,  setMissing]  = useState<string[]>([]);

  const handleSync = async () => {
    setStatus("syncing");
    setErrMsg(null);
    setResult(null);
    try {
      const res  = await fetch("/api/sync-sheets", { method: "POST" });
      const data = await res.json() as {
        ok:       boolean;
        error?:   string;
        missing?: string[];
        resumen?: { codigos: number; lotes: number; movimientos: number };
        ms?:      number;
        syncedAt?:string;
      };

      if (!data.ok && data.error === "no_configurado") {
        setMissing(data.missing ?? []);
        setStatus("unconfigured");
        return;
      }
      if (!data.ok) {
        setErrMsg(data.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }
      if (data.resumen) {
        setResult({
          codigos:     data.resumen.codigos,
          lotes:       data.resumen.lotes,
          movimientos: data.resumen.movimientos,
          ms:          data.ms ?? 0,
          syncedAt:    data.syncedAt ?? new Date().toISOString(),
        });
      }
      setStatus("ok");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Error desconocido");
      setStatus("error");
    }
  };

  const hora = result
    ? new Date(result.syncedAt).toLocaleTimeString("es-DO", {
        timeZone: "America/Santo_Domingo",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1E8C3A]/10 flex items-center justify-center flex-shrink-0">
          <span className="text-xl">📊</span>
        </div>
        <div>
          <h3 className="font-bold text-sm text-[#1A1A1A]">Sincronización Google Sheets</h3>
          <p className="text-xs text-gray-400">
            Exporta códigos, lotes Weight y movimientos al spreadsheet
          </p>
        </div>
      </div>

      {/* Tabs que se sincronizan */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: "🏷️", label: "Códigos",      desc: "codigos_cajas"     },
          { icon: "⚖️", label: "Lotes Weight", desc: "lotes_weight"      },
          { icon: "📦", label: "Movimientos",  desc: "movimientos_loker" },
        ].map((t) => (
          <div key={t.label} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-center">
            <p className="text-base">{t.icon}</p>
            <p className="text-xs font-semibold text-gray-700 mt-0.5">{t.label}</p>
            <p className="text-[10px] text-gray-400 font-mono">{t.desc}</p>
          </div>
        ))}
      </div>

      {/* Estado actual */}
      {status === "ok" && result && (
        <div className="bg-[#1E8C3A]/8 border border-[#1E8C3A]/20 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <p className="text-sm font-semibold text-[#1E8C3A]">
              Sincronizado a las {hora} ({result.ms}ms)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-black text-gray-800">{result.codigos}</p>
              <p className="text-[10px] text-gray-400">códigos</p>
            </div>
            <div>
              <p className="text-lg font-black text-gray-800">{result.lotes}</p>
              <p className="text-[10px] text-gray-400">lotes</p>
            </div>
            <div>
              <p className="text-lg font-black text-gray-800">{result.movimientos}</p>
              <p className="text-[10px] text-gray-400">movimientos</p>
            </div>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-red-600 mb-0.5">❌ Error al sincronizar</p>
          {errMsg && <p className="text-xs text-red-400 font-mono break-all">{errMsg}</p>}
        </div>
      )}

      {status === "unconfigured" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-700">⚙️ Pendiente de configurar</p>
          <p className="text-xs text-amber-600">
            Agrega estas variables en Vercel → Settings → Environment Variables:
          </p>
          <div className="space-y-1">
            {(missing.length > 0 ? missing : [
              "GOOGLE_SHEETS_ID",
              "GOOGLE_SERVICE_ACCOUNT_EMAIL",
              "GOOGLE_PRIVATE_KEY",
            ]).map((v) => (
              <div key={v}
                className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-1.5">
                <span className="text-amber-400 text-xs">🔑</span>
                <code className="text-xs font-mono text-amber-800">{v}</code>
              </div>
            ))}
          </div>
          <a
            href="https://console.cloud.google.com/iam-admin/serviceaccounts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline mt-1"
          >
            → Crear service account en Google Cloud ↗
          </a>
        </div>
      )}

      {/* Botón de sync */}
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95
          disabled:opacity-50 flex items-center justify-center gap-2
          bg-[#1E8C3A] text-white hover:brightness-95"
      >
        {status === "syncing" ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Sincronizando…
          </>
        ) : (
          <><span>🔄</span> Sincronizar ahora</>
        )}
      </button>

      <p className="text-[10px] text-gray-300 text-center leading-relaxed">
        El cron nocturno (23:00 h) sincroniza automáticamente.<br />
        Usa este botón para forzar una sincronización manual.
      </p>
    </div>
  );
}
