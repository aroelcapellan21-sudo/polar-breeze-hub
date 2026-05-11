"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, query, limit, onSnapshot } from "firebase/firestore";
import { ShareBar } from "@/components/shared/ShareButtons";
import { db } from "@/lib/firebase";

type ServiceStatus = "ok" | "warning" | "error" | "unknown" | "verificando";

interface Check {
  status:  ServiceStatus;
  message: string;
  detail?: string;
  ms?:     number;
}

interface StatusData {
  firebase:  Check;
  anthropic: Check;
  telegram:  Check;
  vercel:    Check;
  envVars:   { name: string; label: string; required: boolean; set: boolean }[];
  checkedAt: string;
}

const SEM: Record<ServiceStatus, { dot: string; badge: string; label: string }> = {
  ok:          { dot: "bg-green-500",  badge: "bg-green-50 text-green-700 border-green-200",  label: "OK"          },
  warning:     { dot: "bg-yellow-400", badge: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "Advertencia" },
  error:       { dot: "bg-red-500",    badge: "bg-red-50 text-red-700 border-red-200",        label: "Error"       },
  unknown:     { dot: "bg-gray-400",   badge: "bg-gray-50 text-gray-600 border-gray-200",     label: "Desconocido" },
  verificando: { dot: "bg-blue-400 animate-pulse", badge: "bg-blue-50 text-blue-600 border-blue-200", label: "Verificando" },
};

const ICON: Record<string, string> = {
  ok: "✅", warning: "⚠️", error: "🚨", unknown: "⚫", verificando: "🔵",
};

export default function StatusDashboard() {
  const [data,      setData]      = useState<StatusData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  // Firebase: client-side connection monitor via Firestore listener
  const [fbClient, setFbClient] = useState<ServiceStatus>("verificando");

  useEffect(() => {
    const timer = setTimeout(() => {
      setFbClient((p) => p === "verificando" ? "error" : p);
    }, 10000);

    const unsub = onSnapshot(
      query(collection(db, "usuarios"), limit(1)),
      { includeMetadataChanges: true },
      (snap) => {
        clearTimeout(timer);
        setFbClient(snap.metadata.fromCache ? "warning" : "ok");
      },
      () => {
        clearTimeout(timer);
        setFbClient("error");
      }
    );

    return () => { unsub(); clearTimeout(timer); };
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as StatusData;
      setData(json);
      setLastCheck(new Date());
    } catch {
      // keep previous data if any
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Merge server Firebase status with client-side real-time status
  const fbStatus: Check = {
    status:  fbClient,
    message: fbClient === "ok"          ? "Conectado (tiempo real)"
           : fbClient === "warning"     ? "Datos en caché (sin red)"
           : fbClient === "verificando" ? "Verificando..."
           :                             "Sin conexión",
    detail: data?.firebase?.detail,
    ms:     data?.firebase?.ms,
  };

  const services: { key: string; icon: string; label: string; check: Check }[] = [
    { key: "firebase",  icon: "🔥", label: "Firebase",       check: fbStatus },
    { key: "anthropic", icon: "🤖", label: "Anthropic AI",   check: data?.anthropic ?? { status: "verificando", message: "Verificando..." } },
    { key: "telegram",  icon: "✈️", label: "Telegram Bot",   check: data?.telegram  ?? { status: "verificando", message: "Verificando..." } },
    { key: "vercel",    icon: "▲",  label: "Vercel Deploy",  check: data?.vercel    ?? { status: "verificando", message: "Verificando..." } },
  ];

  const overallStatus: ServiceStatus = services.some(s => s.check.status === "error")
    ? "error"
    : services.some(s => s.check.status === "warning")
    ? "warning"
    : services.every(s => s.check.status === "ok")
    ? "ok"
    : "verificando";

  return (
    <div className="space-y-5">

      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-gray-800 text-lg">Estado del Sistema</h2>
          {lastCheck && (
            <p className="text-xs text-gray-400 mt-0.5">
              Última verificación: {lastCheck.toLocaleTimeString("es-MX")} · actualiza cada 60s
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium
            ${SEM[overallStatus].badge}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${SEM[overallStatus].dot}`} />
            {ICON[overallStatus]} Estado general: {SEM[overallStatus].label}
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700
              active:scale-95 text-white rounded-lg text-sm font-medium transition-all
              duration-100 disabled:opacity-60"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : "🔄"} Verificar ahora
          </button>
          <ShareBar getMessage={() => {
            const fecha = new Date().toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
            const lines = [`🖥️ Estado Sistema — ${fecha}`];
            services.forEach((s) =>
              lines.push(`• ${s.icon} ${s.label}: ${SEM[s.check.status].label} — ${s.check.message}`)
            );
            return lines.join("\n");
          }} />
        </div>
      </div>

      {/* ── Cards de servicios ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map(({ key, icon, label, check }) => {
          const sem = SEM[check.status];
          return (
            <div key={key} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${
              check.status === "ok"      ? "border-green-400" :
              check.status === "warning" ? "border-yellow-400" :
              check.status === "error"   ? "border-red-400" :
                                          "border-gray-300"
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{icon}</span>
                  <p className="font-semibold text-gray-700 text-sm">{label}</p>
                </div>
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${sem.dot}`} />
              </div>
              <p className={`text-sm font-medium mb-0.5 ${
                check.status === "ok"      ? "text-green-700" :
                check.status === "warning" ? "text-yellow-700" :
                check.status === "error"   ? "text-red-700" :
                                            "text-gray-500"
              }`}>
                {ICON[check.status]} {check.message}
              </p>
              {check.detail && (
                <p className="text-xs text-gray-400 truncate" title={check.detail}>
                  {check.detail}
                </p>
              )}
              {check.ms != null && (
                <p className="text-xs text-gray-300 mt-1">{check.ms}ms</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Variables de entorno ── */}
      {data?.envVars && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-4">🔑 Variables de Entorno</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {data.envVars.map(({ name, label, required, set }) => (
              <div key={name} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                set
                  ? "bg-green-50 border-green-100"
                  : required
                  ? "bg-red-50 border-red-100"
                  : "bg-gray-50 border-gray-100"
              }`}>
                <span className="text-base">{set ? "✅" : required ? "🚨" : "⚪"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{label}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{name}</p>
                </div>
                <span className={`text-xs font-semibold flex-shrink-0 ${
                  set ? "text-green-600" : required ? "text-red-600" : "text-gray-400"
                }`}>
                  {set ? "✓ activa" : required ? "falta" : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Configuración Telegram ── */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <h3 className="font-bold text-blue-700 mb-2 text-sm">📋 Configuración requerida en Vercel</h3>
        <div className="space-y-1 text-xs text-blue-600 font-mono">
          <p><strong>TELEGRAM_BOT_TOKEN</strong> = token del bot de @BotFather</p>
          <p><strong>TELEGRAM_CHAT_IDS</strong> = {"`"}6533031969,6578945006{"`"} (IDs separados por coma)</p>
          <p><strong>ANTHROPIC_API_KEY</strong> = sk-ant-...</p>
        </div>
        <p className="text-xs text-blue-500 mt-2">
          Notificaciones enviadas a todos los chat IDs configurados simultáneamente.
        </p>
      </div>

      {/* ── Eventos que disparan notificaciones ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="font-bold text-gray-700 mb-3">🔔 Eventos que notifican por Telegram</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { icon: "💥", label: "Error en cualquier página o componente", via: "ErrorBoundary" },
            { icon: "🚨", label: "Fallo en la API de Anthropic (/analyze)", via: "/api/analyze" },
            { icon: "🔥", label: "Firebase sin conexión (cliente detecta)", via: "StatusDashboard" },
            { icon: "🏗️", label: "Build fallido en GitHub Actions", via: "workflow notify-build.yml" },
          ].map((e) => (
            <div key={e.label} className="flex items-start gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-base flex-shrink-0">{e.icon}</span>
              <div>
                <p className="text-xs font-medium text-gray-700">{e.label}</p>
                <p className="text-xs text-gray-400 font-mono">{e.via}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
