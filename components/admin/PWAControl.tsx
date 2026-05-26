"use client";

/**
 * PWAControl — Tab "📱 PWA" del Hub Admin.
 * Muestra en tiempo real:
 *  - URLs de instalación (QR-link) de cada PWA
 *  - Sesiones activas (usuarios con SW registrado → colección pwa_sessions)
 *  - Modo mantenimiento por app
 *  - Envío de push notifications (cuando VAPID esté configurado)
 */

import { useState, useEffect } from "react";
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface PWASession {
  uid:        string;
  nombre:     string;
  role:       string;
  scope:      string;
  standalone: boolean;
  userAgent:  string;
  updatedAt:  { seconds: number } | null;
}

interface MantenimientoConfig {
  despachador?: boolean;
  encargado?:   boolean;
  mensaje?:     string;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://polar-breeze-hub.vercel.app";

const APPS = [
  {
    id:    "despachador",
    label: "App Despachador",
    icon:  "🚛",
    color: "#D42B2B",
    pill:  "bg-[#D42B2B]/10 border-[#D42B2B]/30 text-[#D42B2B]",
    url:   `${BASE_URL}/app-despachador`,
  },
  {
    id:    "encargado",
    label: "App Encargado",
    icon:  "🏭",
    color: "#1E8C3A",
    pill:  "bg-[#1E8C3A]/10 border-[#1E8C3A]/30 text-[#1E8C3A]",
    url:   `${BASE_URL}/app-encargado`,
  },
] as const;

export default function PWAControl() {
  const { profile } = useAuth();
  const [sessions, setSessions]   = useState<PWASession[]>([]);
  const [mant,     setMant]       = useState<MantenimientoConfig>({});
  const [mantMsg,  setMantMsg]    = useState("");
  const [saving,   setSaving]     = useState(false);
  const [copied,   setCopied]     = useState<string | null>(null);

  // Sesiones activas (SW registrado)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "pwa_sessions"),
      (snap) => setSessions(snap.docs.map((d) => d.data() as PWASession)),
      (err) => console.warn("PWAControl [pwa_sessions]:", err)
    );
    return unsub;
  }, []);

  // Config mantenimiento
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "pwa"),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as MantenimientoConfig;
        setMant(d);
        setMantMsg(d.mensaje ?? "");
      },
      (err) => console.warn("PWAControl [config/pwa]:", err)
    );
    return unsub;
  }, []);

  const toggleMant = async (appId: "despachador" | "encargado") => {
    setSaving(true);
    const next = { ...mant, [appId]: !mant[appId], mensaje: mantMsg };
    await setDoc(doc(db, "config", "pwa"), next, { merge: true }).catch(console.warn);
    setSaving(false);
  };

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const deleteSession = async (uid: string) => {
    await deleteDoc(doc(db, "pwa_sessions", uid)).catch(console.warn);
  };

  const sessDesp = sessions.filter((s) => s.role === "despachador");
  const sessEnc  = sessions.filter((s) => s.role === "encargado");

  const fmtUA = (ua: string) => {
    if (/android/i.test(ua)) return "🤖 Android";
    if (/iphone|ipad/i.test(ua)) return "🍎 iOS";
    if (/windows/i.test(ua)) return "🪟 Windows";
    if (/mac/i.test(ua)) return "🍎 Mac";
    return "💻 Desktop";
  };

  return (
    <div className="space-y-4 max-w-3xl">

      {/* ── Cabecera ── */}
      <div className="bg-[#1A1A1A] rounded-2xl p-5 flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-lg"
          style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
        >
          📱
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-black text-base">Control de PWAs</h2>
          <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">
            Administra las apps instaladas en dispositivos de Despachadores y Encargados.
            Controla el modo mantenimiento y monitorea sesiones activas.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[#F5C800] font-black text-lg">{sessions.length}</p>
          <p className="text-gray-500 text-[10px]">sesiones</p>
        </div>
      </div>

      {/* ── Apps ── */}
      {APPS.map((app) => {
        const sessList = app.id === "despachador" ? sessDesp : sessEnc;
        const mantOn   = mant[app.id as "despachador" | "encargado"] ?? false;

        return (
          <div key={app.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

            {/* Header app */}
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderLeft: `4px solid ${app.color}` }}>
              <span className="text-2xl">{app.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-gray-900">{app.label}</p>
                <p className="text-xs text-gray-400 truncate">{app.url}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Toggle mantenimiento */}
                <button
                  onClick={() => toggleMant(app.id as "despachador" | "encargado")}
                  disabled={saving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold
                    border transition-all active:scale-95 ${
                    mantOn
                      ? "bg-red-100 border-red-300 text-red-700"
                      : "bg-green-50 border-green-200 text-green-700"
                  }`}
                >
                  {mantOn ? "🔴 Mantenimiento" : "🟢 Online"}
                </button>
                {/* Copiar URL */}
                <button
                  onClick={() => copyUrl(app.url, app.id)}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center
                    justify-center text-sm active:scale-95 transition-all"
                  title="Copiar URL de instalación"
                >
                  {copied === app.id ? "✅" : "📋"}
                </button>
              </div>
            </div>

            {/* Banda tricolor */}
            <div className="flex h-0.5">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {/* Sesiones activas */}
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-gray-400 mb-2">
                SW registrado · {sessList.length} dispositivo{sessList.length !== 1 ? "s" : ""}
              </p>
              {sessList.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-2">
                  Ningún dispositivo ha instalado esta app aún.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {sessList.map((s) => (
                    <div key={s.uid}
                      className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <span className="text-sm">{fmtUA(s.userAgent)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{s.nombre}</p>
                        <p className="text-[10px] text-gray-400">
                          {s.standalone ? "📲 Instalada" : "🌐 Navegador"}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteSession(s.uid)}
                        className="text-gray-300 hover:text-red-400 text-xs active:scale-90 transition-all"
                        title="Eliminar sesión"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* QR + Link de instalación */}
            <div className="px-5 pb-4">
              <div className="bg-[#F9F9F7] rounded-xl px-3 py-3 flex items-center gap-3">
                <span className="text-2xl">🔗</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                    Comparte este enlace para instalar
                  </p>
                  <p className="text-xs text-gray-700 truncate font-mono">{app.url}</p>
                </div>
                <button
                  onClick={() => copyUrl(app.url, `${app.id}-bottom`)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold
                    bg-[#1A1A1A] text-white active:scale-95 transition-all"
                >
                  {copied === `${app.id}-bottom` ? "✅" : "Copiar"}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Mensaje de mantenimiento global ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-bold text-sm text-gray-800 mb-2">
          📢 Mensaje de mantenimiento
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Se mostrará en las apps cuando estén en modo mantenimiento.
        </p>
        <textarea
          value={mantMsg}
          onChange={(e) => setMantMsg(e.target.value)}
          placeholder="Ej: Sistema en mantenimiento, volvemos en 15 minutos."
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
            outline-none focus:ring-2 focus:ring-[#F5C800] resize-none text-gray-800"
        />
        <button
          onClick={() =>
            setDoc(doc(db, "config", "pwa"), { ...mant, mensaje: mantMsg }, { merge: true })
              .catch(console.warn)
          }
          className="mt-2 px-4 py-2 bg-[#F5C800] text-[#1A1A1A] rounded-xl text-xs font-black active:scale-95 transition-all"
        >
          Guardar mensaje
        </button>
      </div>

      {/* ── Info subdominios ── */}
      <div className="bg-[#1A1A1A] rounded-2xl p-5">
        <h3 className="text-[#F5C800] font-black text-sm mb-3">🌐 Subdominios (dominio personalizado)</h3>
        <div className="space-y-2 text-xs font-mono">
          {[
            { sub: "despachador.tudominio.com", dest: "/app-despachador", color: "#D42B2B" },
            { sub: "encargado.tudominio.com",   dest: "/app-encargado",   color: "#1E8C3A" },
            { sub: "hub.tudominio.com",         dest: "/",               color: "#F5C800" },
          ].map((r) => (
            <div key={r.sub} className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
              <span className="font-bold" style={{ color: r.color }}>{r.sub}</span>
              <span className="text-gray-500">→</span>
              <span className="text-gray-300">{r.dest}</span>
            </div>
          ))}
        </div>
        <p className="text-gray-500 text-[10px] mt-3 leading-relaxed">
          Configura estos registros CNAME en tu DNS apuntando a{" "}
          <span className="text-gray-300">cname.vercel-dns.com</span> y agrégalos en el
          dashboard de Vercel → Settings → Domains.
        </p>
      </div>

    </div>
  );
}
