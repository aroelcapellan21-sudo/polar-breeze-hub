"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PasswordInput from "@/components/shared/PasswordInput";
import {
  collection, getDocs, doc, setDoc, updateDoc, Timestamp, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { UserProfile } from "@/lib/types";
import CuartoFrio    from "@/components/despachador/CuartoFrio";
import Choferes      from "@/components/despachador/Choferes";
import Comparar      from "@/components/despachador/Comparar";
import Historial     from "@/components/despachador/Historial";
import InformeCierre         from "@/components/despachador/InformeCierre";
import AvisoBon              from "@/components/despachador/AvisoBon";
import AnomaliasDespachador  from "@/components/admin/AnomaliasDespachador";
import FloatingFAB          from "@/components/shared/FloatingFAB";
import ConsultarTablaModal  from "@/components/shared/ConsultarTablaModal";
import RolePill             from "@/components/shared/RolePill";
import PWAInstallBanner     from "@/components/shared/PWAInstallBanner";
import AsistenteAI          from "@/components/shared/AsistenteAI";
import WelcomeBanner        from "@/components/shared/WelcomeBanner";

type Tab = "cuartofrio" | "choferes" | "comparar" | "historial" | "cierre" | "anomalias";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "cuartofrio", icon: "🥶", label: "Cuarto Frío" },
  { key: "choferes",   icon: "🚛", label: "Choferes"    },
  { key: "comparar",   icon: "⚖️", label: "Comparar"    },
  { key: "historial",  icon: "📅", label: "Historial"   },
  { key: "cierre",     icon: "📋", label: "Cierre"      },
  { key: "anomalias",  icon: "⚠️", label: "Anomalías"   },
];

export default function DespachadorDashboard() {
  const { profile, logout } = useAuth();
  const [tab,        setTab]        = useState<Tab>("cuartofrio");
  const [selChofer,  setSelChofer]  = useState<UserProfile | null>(null);

  // Deep-link desde los shortcuts del manifest PWA (?tab=...) — comportamiento nativo
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some(x => x.key === t)) setTab(t as Tab);
  }, []);

  // Identidad del despachador activo
  const [despNombre,        setDespNombre]        = useState("");
  const [listaDespachadores, setListaDespachadores] = useState<string[]>([]);
  const [showNombreModal,   setShowNombreModal]   = useState(false);
  const [nombreCustom,      setNombreCustom]      = useState("");

  useEffect(() => {
    getDoc(doc(db, "config", "main")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setListaDespachadores((d.listaDespachadores as string[]) ?? []);
        setDespNombre((d.despachadorActivo as string) ?? "");
      }
    });
  }, []);

  const selectDespachador = async (nombre: string) => {
    setDespNombre(nombre);
    setShowNombreModal(false);
    setNombreCustom("");
    try {
      await setDoc(doc(db, "config", "main"), { despachadorActivo: nombre }, { merge: true });
    } catch { /* non-critical */ }
  };

  // Restablecer modal state
  const [showReset,   setShowReset]   = useState(false);
  const [resetPwd,    setResetPwd]    = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg,    setResetMsg]    = useState<{ type: "ok"|"err"; text: string }|null>(null);
  const [showTablas,  setShowTablas]  = useState(false);

  const flashReset = (type: "ok"|"err", text: string) => {
    setResetMsg({ type, text });
    setTimeout(() => setResetMsg(null), 4000);
  };

  const handleReset = async () => {
    if (!resetPwd) return;
    setResetLoading(true);
    try {
      // Verify reset password from config/main
      const cfgSnap = await getDoc(doc(db, "config", "main"));
      const storedPwd = cfgSnap.exists() ? cfgSnap.data()?.resetPassword : null;
      if (!storedPwd || storedPwd !== resetPwd) {
        flashReset("err", "Clave de Restablecer incorrecta");
        setResetLoading(false);
        return;
      }

      // Clear session/despacho
      await setDoc(doc(db, "session", "despacho"), {
        cuartoFrio: [],
        totalProductos: 0, totalUnidades: 0, totalPeso: null,
        totalDespachos: 0, totalMonto: 0,
        despachadorId: profile?.uid ?? "",
        despachadorNombre: profile?.nombre ?? "",
        fecha: Timestamp.now(), estado: "activa",
        resetAt: Timestamp.now(),
      });

      // Clear each driver's entregas
      const driversSnap = await getDocs(collection(db, "drivers"));
      await Promise.all(
        driversSnap.docs.map((d) =>
          updateDoc(doc(db, "drivers", d.id), {
            entregas: [], totalEntregado: 0, totalMonto: null,
            observaciones: null, updatedAt: Timestamp.now(),
          }).catch(() => {/* ignore if doc doesn't have those fields */})
        )
      );

      flashReset("ok", "Día restablecido ✓ — historial conservado en Firebase");
      setResetPwd("");
      setTimeout(() => setShowReset(false), 2000);
    } catch (e) {
      flashReset("err", e instanceof Error ? e.message : "Error al restablecer");
    } finally {
      setResetLoading(false);
    }
  };

  // ── Flechas de navegación de tabs ────────────────────────────────────────
  const navRef  = useRef<HTMLElement>(null);
  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", checkScroll); ro.disconnect(); };
  }, [checkScroll]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLButtonElement>("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    setTimeout(checkScroll, 300);
  }, [tab, checkScroll]);

  const scrollNav = (dir: "left" | "right") => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 140 : -140, behavior: "smooth" });
    setTimeout(checkScroll, 350);
  };

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header — gradiente tricolor Polar Breeze ── */}
      <header
        className="text-white shadow-lg sticky top-0 z-30"
        style={{ background: "linear-gradient(90deg, rgba(245,200,0,0.55) 0% 33.33%, rgba(212,43,43,0.55) 33.33% 66.66%, rgba(30,140,58,0.55) 66.66% 100%), #1A1A1A" }}
      >
        {/* ── Fila 1: Logo + Nombre + Acciones ── */}
        <div className="max-w-6xl mx-auto px-4 pt-3 pb-2 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-white/20"
              style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
            >
              <span className="text-base">🧊</span>
            </div>
            <div>
              <p className="text-white/60 text-[9px] leading-none uppercase tracking-widest">Polar Breeze</p>
              <p className="text-white font-black text-sm leading-tight">Despacho</p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowTablas(true)}
              title="Consultar tablas"
              className="bg-white/10 hover:bg-white/20 active:scale-95 w-8 h-8 rounded-lg
                flex items-center justify-center text-base transition-all duration-100"
            >
              📋
            </button>
            <button
              onClick={() => { setShowReset(true); setResetPwd(""); setResetMsg(null); }}
              title="Restablecer día"
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-2 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium whitespace-nowrap hidden sm:block"
            >
              🔄 Reset
            </button>
            <RolePill rol="despachador" nombre={profile?.nombre ?? ""} />
            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 active:scale-95 px-2 py-1.5
                rounded-lg text-xs transition-all duration-100 font-medium flex-shrink-0"
            >
              Salir
            </button>
          </div>
        </div>

        {/* ── Fila 2: Tabs con flechas ── */}
        <div className="max-w-6xl mx-auto px-2 pb-2 flex items-center gap-0.5">
          <button
            onClick={() => scrollNav("left")}
            className={`flex-shrink-0 w-7 h-8 rounded-md flex items-center justify-center
              text-white/70 hover:text-white hover:bg-white/15 transition-all active:scale-90
              text-lg font-bold leading-none
              ${canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            ‹
          </button>
          <nav
            ref={navRef}
            className="flex gap-1 overflow-x-auto scrollbar-none flex-1 scroll-smooth"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                data-active={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                  font-medium whitespace-nowrap transition-all duration-100 active:scale-95
                  flex-shrink-0 ${
                  tab === t.key
                    ? "bg-[#F5C800] text-[#1A1A1A] shadow-sm font-bold"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
          <button
            onClick={() => scrollNav("right")}
            className={`flex-shrink-0 w-7 h-8 rounded-md flex items-center justify-center
              text-white/70 hover:text-white hover:bg-white/15 transition-all active:scale-90
              text-lg font-bold leading-none
              ${canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            ›
          </button>
        </div>

        {/* Banda tricolor */}
        <div className="pb-tricolor" />

        {/* Breadcrumb */}
        <div className="border-t border-white/10 bg-black/20">
          <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center gap-1.5 text-xs text-gray-300 overflow-x-auto">
            {/* Tab name */}
            <button
              onClick={() => { if (tab === "choferes") setSelChofer(null); }}
              className={`whitespace-nowrap font-medium ${
                tab === "choferes" && selChofer ? "hover:text-white transition-colors" : "text-[#F5C800]"
              }`}
            >
              {TABS.find((t) => t.key === tab)?.icon}{" "}
              {tab === "cuartofrio" && "Cuarto Frío — inventario, foto o manual"}
              {tab === "choferes"   && "Choferes — facturas por entrega"}
              {tab === "comparar"   && "Comparar — cuarto frío vs. choferes en tiempo real"}
              {tab === "historial"  && "Historial — registros del día por tipo"}
              {tab === "cierre"     && "Cierre — informe final del día de despacho"}
            {tab === "anomalias"  && "Anomalías — registrar productos faltantes en el despacho"}
            </button>
            {/* Chofer breadcrumb */}
            {tab === "choferes" && selChofer && (
              <>
                <span className="opacity-40 flex-shrink-0">/</span>
                <span className="text-white font-semibold whitespace-nowrap">
                  {selChofer.nombre}
                </span>
                {selChofer.ficha && (
                  <span className="opacity-60 whitespace-nowrap">· ficha {selChofer.ficha}</span>
                )}
              </>
            )}
            <span className="ml-auto flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5C800] animate-pulse" />
              Firebase polar-breeze
            </span>
          </div>
        </div>
      </header>

      <WelcomeBanner nombre={profile?.nombre ?? ""} area="Despacho" acento="#D42B2B" />

      {/* ── Barra de identidad del despachador ── */}
      <div className={`border-b ${despNombre ? "bg-[#FFFBE6] border-[#F5C800]/30" : "bg-[#FFFBE6] border-[#F5C800]/50"}`}>
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3">
          <span className="text-xs text-gray-500">Despachando como:</span>
          {despNombre ? (
            <button
              onClick={() => setShowNombreModal(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1A] active:scale-95 hover:text-[#D42B2B] transition-all duration-100"
            >
              👤 {despNombre}
              <span className="text-xs font-normal text-[#D42B2B]/60">cambiar</span>
            </button>
          ) : (
            <button
              onClick={() => setShowNombreModal(true)}
              className="text-xs bg-[#F5C800]/40 text-[#1A1A1A] px-3 py-1 rounded-full active:scale-95 hover:bg-[#F5C800]/60 transition-all duration-100 font-medium animate-pulse"
            >
              ⚠️ ¿Quién despacha hoy? Toca para identificarte
            </button>
          )}
        </div>
      </div>

      {/* ── Contenido ── */}
      <main className="max-w-6xl mx-auto px-4 py-5">
        {tab === "cuartofrio" && <CuartoFrio despachadorActivo={despNombre} />}
        {tab === "choferes"   && (
          <Choferes despachadorActivo={despNombre} onChoferSelect={setSelChofer} />
        )}
        {tab === "comparar"   && <Comparar />}
        {tab === "historial"  && <Historial />}
        {tab === "cierre"     && (
          <div className="space-y-4">
            <AvisoBon />
            <InformeCierre />
          </div>
        )}
        {tab === "anomalias"  && (
          <AnomaliasDespachador mode="despachador" registradorNombre={despNombre} />
        )}
      </main>

      {/* ── Modal: ¿Quién despacha? ── */}
      {showNombreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setShowNombreModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <p className="text-3xl mb-1">👤</p>
              <h3 className="font-bold text-gray-800 text-lg">¿Quién despacha hoy?</h3>
              <p className="text-xs text-gray-400 mt-1">Tu nombre aparecerá en facturas, WhatsApp y reportes del Admin</p>
            </div>
            {listaDespachadores.length > 0 ? (
              <div className="space-y-2">
                {listaDespachadores.map((nombre) => (
                  <button
                    key={nombre}
                    onClick={() => selectDespachador(nombre)}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all duration-100 active:scale-95 ${
                      despNombre === nombre
                        ? "border-[#D42B2B] bg-[#FFF5F5] text-[#1A1A1A]"
                        : "border-gray-100 hover:border-[#D42B2B]/30 hover:bg-[#FFF5F5]"
                    }`}
                  >
                    👤 {nombre}
                    {despNombre === nombre && <span className="ml-2 text-xs text-[#D42B2B]/60">✓ activo</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">
                El Admin puede configurar la lista en<br/>Configuración → Config.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <input
                value={nombreCustom}
                onChange={(e) => setNombreCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nombreCustom.trim() && selectDespachador(nombreCustom.trim())}
                placeholder="Escribir nombre..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#F5C800]"
              />
              <button
                onClick={() => nombreCustom.trim() && selectDespachador(nombreCustom.trim())}
                disabled={!nombreCustom.trim()}
                className="px-4 py-2 bg-[#D42B2B] text-white rounded-lg text-sm font-medium active:scale-95 disabled:opacity-50 transition-all duration-100"
              >
                OK
              </button>
            </div>
            <button onClick={() => setShowNombreModal(false)} className="w-full py-2 text-gray-400 text-xs hover:text-gray-600 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Restablecer ── */}
      {showReset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <p className="text-3xl mb-2">🔄</p>
              <h3 className="font-bold text-gray-800 text-lg">Restablecer día</h3>
              <p className="text-sm text-gray-500 mt-1">
                Limpia cuarto frío y entregas del día.<br />
                <strong>El historial en Firebase se conserva.</strong>
              </p>
            </div>
            <PasswordInput
              value={resetPwd} autoFocus
              onChange={(e) => setResetPwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetPwd && handleReset()}
              placeholder="Clave de Restablecer"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#F5C800]"
            />
            {resetMsg && (
              <div className={`text-sm px-3 py-2 rounded-lg text-center ${
                resetMsg.type === "ok"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>
                {resetMsg.text}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReset(false); setResetPwd(""); setResetMsg(null); }}
                disabled={resetLoading}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleReset}
                disabled={resetLoading || !resetPwd}
                className="flex-1 py-2.5 rounded-xl bg-[#D42B2B] hover:bg-[#b82424] active:scale-95 text-white text-sm font-bold transition-all duration-100 disabled:opacity-60"
              >
                {resetLoading ? "Restableciendo..." : "Restablecer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Tablas ── */}
      {showTablas && <ConsultarTablaModal onClose={() => setShowTablas(false)} />}

      {/* ── Botón flotante ── */}
      <FloatingFAB />

      {/* ── Asistente IA Gemini ── */}
      <AsistenteAI
        rol="despachador"
        nombre={profile?.nombre}
        contexto={`Tab activo: ${tab}. Usuario: ${profile?.nombre ?? "Despachador"}.`}
      />

      {/* ── Banner de instalación PWA ── */}
      <PWAInstallBanner appName="App Despachador" appIcon="🚛" />
    </div>
  );
}
