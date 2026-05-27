"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, query, limit, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { ShareBar } from "@/components/shared/ShareButtons";
import { db } from "@/lib/firebase";
import { pbHeader, pbFooter } from "@/lib/wa-format";
import { pbPrintDoc, pbTable } from "@/lib/print-template";

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
  const [fbClient,  setFbClient]  = useState<ServiceStatus>("verificando");

  // ── Herramientas de configuración ─────────────────────────────────────────────
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookResult,  setWebhookResult]  = useState<string | null>(null);
  const [cronLoading,    setCronLoading]    = useState(false);
  const [cronResult,     setCronResult]     = useState<string | null>(null);

  // ── Owner password ────────────────────────────────────────────────────────────
  const [ownerLocked,   setOwnerLocked]   = useState(true);
  const [ownerPwd,      setOwnerPwd]      = useState("");
  const [ownerPwdNew,   setOwnerPwdNew]   = useState("");
  const [ownerPwdNew2,  setOwnerPwdNew2]  = useState("");
  const [ownerPwdSet,   setOwnerPwdSet]   = useState<boolean | null>(null);
  const [ownerChangePw, setOwnerChangePw] = useState(false);
  const [ownerMsg,      setOwnerMsg]      = useState<{ type: "ok"|"err"; text: string }|null>(null);
  const [ownerLoading,  setOwnerLoading]  = useState(false);

  useEffect(() => {
    // Timeout fallback: if Firestore takes >5s, show lock screen anyway
    const timeout = setTimeout(() => setOwnerPwdSet((prev) => prev ?? false), 5000);

    getDoc(doc(db, "config", "owner"))
      .then((snap) => {
        setOwnerPwdSet(snap.exists() && !!snap.data()?.password);
      })
      .catch(() => {
        setOwnerPwdSet(false);
      })
      .finally(() => clearTimeout(timeout));
  }, []);

  const flashOwner = (type: "ok"|"err", text: string) => {
    setOwnerMsg({ type, text });
    setTimeout(() => setOwnerMsg(null), 4000);
  };

  const verifyOwner = async () => {
    if (!ownerPwd) return;
    setOwnerLoading(true);
    try {
      const snap = await getDoc(doc(db, "config", "owner"));
      if (snap.exists() && snap.data()?.password === ownerPwd) {
        setOwnerLocked(false); setOwnerPwd("");
      } else {
        flashOwner("err", "Contraseña del dueño incorrecta");
      }
    } catch { flashOwner("err", "Error al verificar"); }
    finally { setOwnerLoading(false); }
  };

  const saveOwnerPassword = async () => {
    if (ownerPwdNew.length < 4) { flashOwner("err", "Mínimo 4 caracteres"); return; }
    if (ownerPwdNew !== ownerPwdNew2) { flashOwner("err", "Las contraseñas no coinciden"); return; }
    setOwnerLoading(true);
    try {
      await setDoc(doc(db, "config", "owner"), { password: ownerPwdNew }, { merge: true });
      setOwnerPwdSet(true); setOwnerPwdNew(""); setOwnerPwdNew2("");
      flashOwner("ok", "Contraseña del dueño establecida ✓");
      setTimeout(() => { setOwnerLocked(false); setOwnerMsg(null); }, 1500);
    } catch (e) { flashOwner("err", e instanceof Error ? e.message : "Error"); }
    finally { setOwnerLoading(false); }
  };

  const changeOwnerPassword = async () => {
    if (!ownerPwd) { flashOwner("err", "Ingresa la contraseña actual"); return; }
    if (ownerPwdNew.length < 4) { flashOwner("err", "Mínimo 4 caracteres"); return; }
    if (ownerPwdNew !== ownerPwdNew2) { flashOwner("err", "Las contraseñas no coinciden"); return; }
    setOwnerLoading(true);
    try {
      const snap = await getDoc(doc(db, "config", "owner"));
      if (!snap.exists() || snap.data()?.password !== ownerPwd) {
        flashOwner("err", "Contraseña actual incorrecta");
        setOwnerLoading(false); return;
      }
      await setDoc(doc(db, "config", "owner"), { password: ownerPwdNew }, { merge: true });
      setOwnerPwd(""); setOwnerPwdNew(""); setOwnerPwdNew2(""); setOwnerChangePw(false);
      flashOwner("ok", "Contraseña del dueño actualizada ✓");
    } catch (e) { flashOwner("err", e instanceof Error ? e.message : "Error"); }
    finally { setOwnerLoading(false); }
  };

  // ── Firebase connection monitor ───────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      setFbClient((p) => p === "verificando" ? "error" : p);
    }, 10000);
    const unsub = onSnapshot(
      query(collection(db, "usuarios"), limit(1)),
      { includeMetadataChanges: true },
      (snap) => { clearTimeout(timer); setFbClient(snap.metadata.fromCache ? "warning" : "ok"); },
      () => { clearTimeout(timer); setFbClient("error"); }
    );
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as StatusData);
      setLastCheck(new Date());
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const registrarWebhook = async () => {
    setWebhookLoading(true);
    setWebhookResult(null);
    try {
      const res  = await fetch("/api/telegram-webhook?setup=1");
      const data = await res.json() as { hookUrl?: string; telegram?: { ok: boolean; description?: string }; error?: string };
      if (data.error) {
        setWebhookResult(`❌ ${data.error}`);
      } else if (data.telegram?.ok) {
        setWebhookResult(`✅ Webhook registrado en:\n${data.hookUrl}`);
      } else {
        setWebhookResult(`⚠️ Respuesta de Telegram: ${data.telegram?.description ?? "sin detalle"}`);
      }
    } catch (e) {
      setWebhookResult(`❌ Error: ${String(e)}`);
    } finally {
      setWebhookLoading(false);
    }
  };

  const probarCron = async () => {
    setCronLoading(true);
    setCronResult(null);
    try {
      const res  = await fetch("/api/cron-nocturno");
      if (res.status === 401) {
        setCronResult("🔒 No autorizado (CRON_SECRET activo — ejecuta manualmente desde Vercel)");
      } else {
        const data = await res.json() as { ok?: boolean; fecha?: string; ms?: number; tareas?: { nombre: string; status: string; detalle?: string }[] };
        if (data.ok && data.tareas) {
          const lineas = [`✅ Cron ejecutado para ${data.fecha} en ${data.ms}ms`, ""];
          data.tareas.forEach((t) => {
            const icn = t.status === "ok" ? "✅" : t.status === "skip" ? "⏭️" : "❌";
            lineas.push(`${icn} ${t.nombre}${t.detalle ? ` — ${t.detalle}` : ""}`);
          });
          setCronResult(lineas.join("\n"));
        } else {
          setCronResult(`⚠️ Respuesta inesperada: ${JSON.stringify(data).slice(0, 200)}`);
        }
      }
    } catch (e) {
      setCronResult(`❌ Error: ${String(e)}`);
    } finally {
      setCronLoading(false);
    }
  };

  // ── Loading owner config ──────────────────────────────────────────────────────
  if (ownerPwdSet === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-purple-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Lock screen ───────────────────────────────────────────────────────────────
  if (ownerLocked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
          <div className="text-center">
            <p className="text-5xl mb-3">👑</p>
            <h2 className="font-bold text-gray-800 text-xl">Sección Estado</h2>
            <p className="text-sm text-gray-500 mt-1">
              {ownerPwdSet
                ? "Acceso exclusivo del dueño del sistema"
                : "Primera vez — establece tu contraseña del dueño"}
            </p>
          </div>

          {ownerPwdSet ? (
            <>
              <input
                type="password" value={ownerPwd} autoFocus
                onChange={(e) => setOwnerPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ownerPwd && verifyOwner()}
                placeholder="Contraseña del dueño"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={verifyOwner} disabled={!ownerPwd || ownerLoading}
                className="w-full bg-purple-700 hover:bg-purple-800 active:scale-95 text-white py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
              >
                {ownerLoading ? "Verificando..." : "🔓 Entrar"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                Esta clave es <strong>diferente</strong> a la del Admin. Solo el dueño la conoce y puede cambiarla desde aquí.
              </p>
              <input
                type="password" value={ownerPwdNew} autoFocus
                onChange={(e) => setOwnerPwdNew(e.target.value)}
                placeholder="Nueva contraseña del dueño (mín. 4 car.)"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
              <input
                type="password" value={ownerPwdNew2}
                onChange={(e) => setOwnerPwdNew2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveOwnerPassword()}
                placeholder="Confirmar contraseña"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={saveOwnerPassword} disabled={!ownerPwdNew || !ownerPwdNew2 || ownerLoading}
                className="w-full bg-purple-700 hover:bg-purple-800 active:scale-95 text-white py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
              >
                {ownerLoading ? "Guardando..." : "👑 Establecer contraseña"}
              </button>
            </>
          )}

          {ownerMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg text-center ${
              ownerMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200"
                                    : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {ownerMsg.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Unlocked dashboard ────────────────────────────────────────────────────────
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
    { key: "firebase",  icon: "🔥", label: "Firebase",     check: fbStatus },
    { key: "anthropic", icon: "🤖", label: "Anthropic AI", check: data?.anthropic ?? { status: "verificando", message: "Verificando..." } },
    { key: "telegram",  icon: "✈️", label: "Telegram Bot", check: data?.telegram  ?? { status: "verificando", message: "Verificando..." } },
    { key: "vercel",    icon: "▲",  label: "Vercel Deploy", check: data?.vercel   ?? { status: "verificando", message: "Verificando..." } },
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
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-gray-800 text-lg">Estado del Sistema</h2>
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              👑 Dueño
            </span>
          </div>
          {lastCheck && (
            <p className="text-xs text-gray-400 mt-0.5">
              Última verificación: {lastCheck.toLocaleTimeString("es-MX")} · actualiza cada 60s
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${SEM[overallStatus].badge}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${SEM[overallStatus].dot}`} />
            {ICON[overallStatus]} Estado general: {SEM[overallStatus].label}
          </div>
          <button
            onClick={fetchStatus} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700
              active:scale-95 text-white rounded-lg text-sm font-medium transition-all duration-100 disabled:opacity-60"
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : "🔄"
            } Verificar ahora
          </button>
          <ShareBar
            getMessage={() => {
              const lines = [pbHeader(), `🖥️ *Estado del Sistema*`, ""];
              services.forEach((s) => lines.push(`• ${s.icon} ${s.label}: ${SEM[s.check.status].label} — ${s.check.message}`));
              lines.push("", pbFooter());
              return lines.join("\n");
            }}
            getPrintHtml={() => pbPrintDoc(
              "ESTADO DEL SISTEMA",
              "",
              pbTable(
                ["Servicio", "Estado", "Mensaje", "Tiempo (ms)"],
                services.map((s) => [
                  `${s.icon} ${s.label}`,
                  SEM[s.check.status].label,
                  s.check.message,
                  s.check.ms ?? "—",
                ]),
              ),
            )}
          />
          <button
            onClick={() => { setOwnerChangePw(!ownerChangePw); setOwnerPwd(""); setOwnerPwdNew(""); setOwnerPwdNew2(""); }}
            className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 active:scale-95 text-purple-700 rounded-lg text-xs font-medium transition"
          >
            🔑 Cambiar clave
          </button>
        </div>
      </div>

      {/* ── Change owner password ── */}
      {ownerChangePw && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 space-y-3 max-w-md">
          <p className="font-semibold text-purple-800 text-sm">🔑 Cambiar contraseña del dueño</p>
          <input
            type="password" value={ownerPwd}
            onChange={(e) => setOwnerPwd(e.target.value)}
            placeholder="Contraseña actual"
            className="w-full px-3 py-2 border border-purple-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
            autoFocus
          />
          <input
            type="password" value={ownerPwdNew}
            onChange={(e) => setOwnerPwdNew(e.target.value)}
            placeholder="Nueva contraseña (mín. 4 car.)"
            className="w-full px-3 py-2 border border-purple-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
          />
          <input
            type="password" value={ownerPwdNew2}
            onChange={(e) => setOwnerPwdNew2(e.target.value)}
            placeholder="Confirmar nueva contraseña"
            className="w-full px-3 py-2 border border-purple-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setOwnerChangePw(false); setOwnerPwd(""); setOwnerPwdNew(""); setOwnerPwdNew2(""); }}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              onClick={changeOwnerPassword}
              disabled={ownerLoading || !ownerPwd || ownerPwdNew.length < 4 || !ownerPwdNew2}
              className="flex-1 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-sm font-semibold transition disabled:opacity-60"
            >
              {ownerLoading ? "Guardando..." : "Guardar"}
            </button>
          </div>
          {ownerMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              ownerMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200"
                                    : "bg-red-50 text-red-700 border border-red-200"
            }`}>{ownerMsg.text}</div>
          )}
        </div>
      )}

      {/* ── Cards de servicios ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map(({ key, icon, label, check }) => {
          const sem = SEM[check.status];
          return (
            <div key={key} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${
              check.status === "ok"      ? "border-green-400" :
              check.status === "warning" ? "border-yellow-400" :
              check.status === "error"   ? "border-red-400" : "border-gray-300"
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
                check.status === "error"   ? "text-red-700" : "text-gray-500"
              }`}>
                {ICON[check.status]} {check.message}
              </p>
              {check.detail && (
                <p className="text-xs text-gray-400 truncate" title={check.detail}>{check.detail}</p>
              )}
              {check.ms != null && <p className="text-xs text-gray-300 mt-1">{check.ms}ms</p>}
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
                set ? "bg-green-50 border-green-100"
                    : required ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100"
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

      {/* ── Herramientas de administración ── */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-gray-700">🛠️ Herramientas</h3>
        <div className="grid sm:grid-cols-2 gap-4">

          {/* Registrar Webhook */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-semibold text-gray-700 text-sm">✈️ Webhook Telegram</p>
              <p className="text-xs text-gray-400 mt-0.5">Registra o actualiza la URL del webhook en Telegram</p>
            </div>
            <button
              onClick={registrarWebhook}
              disabled={webhookLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-gray-800 active:scale-95
                text-white rounded-lg text-sm font-medium transition-all duration-100 disabled:opacity-60"
            >
              {webhookLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : "📡"
              }
              {webhookLoading ? "Registrando…" : "Registrar Webhook"}
            </button>
            {webhookResult && (
              <pre className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap text-gray-700 font-mono">
                {webhookResult}
              </pre>
            )}
          </div>

          {/* Probar Cron */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <p className="font-semibold text-gray-700 text-sm">⏰ Cron Nocturno</p>
              <p className="text-xs text-gray-400 mt-0.5">Ejecuta manualmente la automatización nocturna</p>
            </div>
            <button
              onClick={probarCron}
              disabled={cronLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1E8C3A] hover:bg-green-700 active:scale-95
                text-white rounded-lg text-sm font-medium transition-all duration-100 disabled:opacity-60"
            >
              {cronLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : "▶️"
              }
              {cronLoading ? "Ejecutando…" : "Probar Cron"}
            </button>
            {cronResult && (
              <pre className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap text-gray-700 font-mono">
                {cronResult}
              </pre>
            )}
          </div>
        </div>
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
