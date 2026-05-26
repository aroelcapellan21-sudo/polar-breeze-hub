"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { collection, query, where, orderBy, onSnapshot, limit, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ImbentarioRecord, UserProfile, PuntoProducto, toDate, fmtDate } from "@/lib/types";

type AnomaliaType = "sobreventado" | "complementacion" | "minimo_puntos" | "venta_baja";
type SemaforoColor = "verde" | "amarillo" | "rojo";

interface Anomalia {
  id: string;
  tipo: AnomaliaType;
  choferNombre: string;
  choferId?: string;
  descripcion: string;
  severity: SemaforoColor;
  timestamp: Date;
}

const TIPO_CFG: Record<AnomaliaType, { icon: string; label: string; bg: string; border: string; text: string }> = {
  sobreventado:    { icon: "🚨", label: "Sobreventado",         bg: "bg-red-50",    border: "border-red-200",    text: "text-red-700"    },
  complementacion: { icon: "🕵️", label: "Complementación",      bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
  minimo_puntos:   { icon: "🎯", label: "Mínimo exacto puntos", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" },
  venta_baja:      { icon: "📉", label: "Venta baja histórica", bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700"  },
};

const SEM_CFG: Record<SemaforoColor, { dot: string; ring: string; bg: string; label: string }> = {
  verde:    { dot: "bg-green-500",  ring: "ring-green-300",  bg: "bg-green-50",  label: "Sin anomalías" },
  amarillo: { dot: "bg-yellow-500", ring: "ring-yellow-300", bg: "bg-yellow-50", label: "Revisión" },
  rojo:     { dot: "bg-red-500",    ring: "ring-red-300",    bg: "bg-red-50",    label: "Crítico" },
};

export default function Anomalias() {
  const [choferes,  setChoferes]  = useState<UserProfile[]>([]);
  const [imb,       setImb]       = useState<ImbentarioRecord[]>([]);
  const [meta,      setMeta]      = useState(0);
  const [puntoProd, setPuntoProd] = useState<PuntoProducto[]>([]);
  const [tgLoading,    setTgLoading]    = useState(false);
  const [tgMsg,        setTgMsg]        = useState<string | null>(null);
  const [filtro,       setFiltro]       = useState<AnomaliaType | "todas">("todas");
  const [iaLoading,    setIaLoading]    = useState(false);
  const [iaAnalisis,   setIaAnalisis]   = useState<string | null>(null);
  const [iaModalOpen,  setIaModalOpen]  = useState(false);
  const sentRef = useRef(false);

  useEffect(() => {
    const uChof = onSnapshot(
      query(collection(db, "usuarios"), where("role", "==", "chofer")),
      (s) => setChoferes(s.docs.map((d) => d.data() as UserProfile))
    );
    const uImb = onSnapshot(
      query(collection(db, "imbentario"), orderBy("timestamp", "desc"), limit(600)),
      (s) => setImb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ImbentarioRecord)))
    );
    getDoc(doc(db, "config", "puntos")).then((snap) => {
      if (snap.exists()) {
        const pd = snap.data();
        setMeta(pd.meta ?? 0);
        setPuntoProd(pd.productos ?? []);
      }
    });
    return () => { uChof(); uImb(); };
  }, []);

  const hoy = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const hace15 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 15); return d; }, []);
  const hace30 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; }, []);

  const imbHoy = useMemo(() => imb.filter((r) => toDate(r.timestamp) >= hoy), [imb, hoy]);
  const imb15  = useMemo(() => imb.filter((r) => toDate(r.timestamp) >= hace15), [imb, hace15]);
  const imb30  = useMemo(() => imb.filter((r) => toDate(r.timestamp) >= hace30), [imb, hace30]);

  const puntosMap = useMemo(() => {
    const map: Record<string, number> = {};
    puntoProd.forEach((p) => { map[p.nombre.toLowerCase().trim()] = p.puntos; });
    return map;
  }, [puntoProd]);

  const anomalias = useMemo((): Anomalia[] => {
    const out: Anomalia[] = [];
    const now = new Date();

    // ── 1. SOBREVENTADO ──────────────────────────────────────────────────────
    choferes.forEach((ch) => {
      imbHoy.filter((r) => r.choferId === ch.uid).forEach((r) => {
        const entr = r.cantidadEntregada ?? 0;
        const carg = r.cantidadCargada ?? 0;
        if (entr > carg && carg > 0) {
          out.push({
            id: `sobrev-${ch.uid}-${r.id}`,
            tipo: "sobreventado",
            choferNombre: ch.nombre,
            choferId: ch.uid,
            descripcion: `Reportó ${entr - carg} uds más vendidas que despachadas en "${r.producto}" (${entr} vs ${carg})`,
            severity: "rojo",
            timestamp: toDate(r.timestamp),
          });
        }
      });
    });

    // ── 2. COMPLEMENTACIÓN SOSPECHOSA ────────────────────────────────────────
    const diffPorChofer = choferes
      .map((ch) => {
        const recs = imbHoy.filter((r) => r.choferId === ch.uid);
        if (recs.length === 0) return null;
        const carg = recs.reduce((s, r) => s + (r.cantidadCargada ?? 0), 0);
        const entr = recs.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
        return { ch, diff: carg - entr, carg, entr };
      })
      .filter(Boolean) as { ch: UserProfile; diff: number; carg: number; entr: number }[];

    for (let i = 0; i < diffPorChofer.length; i++) {
      for (let j = i + 1; j < diffPorChofer.length; j++) {
        const a = diffPorChofer[i], b = diffPorChofer[j];
        const sum = a.diff + b.diff;
        if (Math.abs(sum) <= 2 && Math.abs(a.diff) >= 5) {
          const fa = `${a.ch.nombre} (${a.diff > 0 ? "+" : ""}${a.diff})`;
          const fb = `${b.ch.nombre} (${b.diff > 0 ? "+" : ""}${b.diff})`;
          out.push({
            id: `compl-${a.ch.uid}-${b.ch.uid}`,
            tipo: "complementacion",
            choferNombre: `${a.ch.nombre} & ${b.ch.nombre}`,
            descripcion: `Diferencias se cancelan: ${fa} + ${fb} = ${sum}. Posible encubrimiento.`,
            severity: "amarillo",
            timestamp: now,
          });
        }
      }
    }

    // ── 3. MÍNIMO EXACTO DE PUNTOS ───────────────────────────────────────────
    if (meta > 0) {
      choferes.forEach((ch) => {
        const recs = imb15.filter((r) => r.choferId === ch.uid);
        const porDia: Record<string, number> = {};
        recs.forEach((r) => {
          const dia = toDate(r.timestamp).toDateString();
          const key = (r.producto ?? "").toLowerCase().trim();
          const pts = puntosMap[key] ?? 1;
          porDia[dia] = (porDia[dia] ?? 0) + (r.cantidadEntregada ?? 0) * pts;
        });
        const dias = Object.values(porDia).filter((v) => v > 0);
        if (dias.length < 3) return;
        const cerca = dias.filter((v) => v >= meta * 0.9 && v <= meta * 1.1);
        if (cerca.length >= 3 && cerca.length / dias.length >= 0.6) {
          out.push({
            id: `minpts-${ch.uid}`,
            tipo: "minimo_puntos",
            choferNombre: ch.nombre,
            choferId: ch.uid,
            descripcion: `${cerca.length} de ${dias.length} días vende exactamente en la zona de meta (${meta} pts ±10%). Posible manipulación.`,
            severity: "amarillo",
            timestamp: now,
          });
        }
      });
    }

    // ── 4. VENTA BAJA HISTÓRICA ──────────────────────────────────────────────
    choferes.forEach((ch) => {
      const recsHoy = imbHoy.filter((r) => r.choferId === ch.uid);
      if (recsHoy.length === 0) return;
      const pasados = imb30.filter((r) => r.choferId === ch.uid && toDate(r.timestamp) < hoy);
      const porDia: Record<string, number> = {};
      pasados.forEach((r) => {
        const dia = toDate(r.timestamp).toDateString();
        porDia[dia] = (porDia[dia] ?? 0) + (r.cantidadEntregada ?? 0);
      });
      const vals = Object.values(porDia);
      if (vals.length < 5) return;
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const hoyTotal = recsHoy.reduce((s, r) => s + (r.cantidadEntregada ?? 0), 0);
      if (hoyTotal < avg * 0.6 && avg > 10) {
        const pct = Math.round((hoyTotal / avg) * 100);
        out.push({
          id: `ventabaja-${ch.uid}`,
          tipo: "venta_baja",
          choferNombre: ch.nombre,
          choferId: ch.uid,
          descripcion: `Venta hoy: ${hoyTotal} uds = ${pct}% del promedio histórico (${Math.round(avg)} uds/día, base ${vals.length} días).`,
          severity: hoyTotal < avg * 0.4 ? "rojo" : "amarillo",
          timestamp: now,
        });
      }
    });

    return out.sort((a, b) => (a.severity === "rojo" ? -1 : 1) - (b.severity === "rojo" ? -1 : 1));
  }, [choferes, imbHoy, imb15, imb30, meta, puntosMap, hoy]);

  // Semáforo por chofer
  const semaforoPorChofer = useMemo(() => {
    const map: Record<string, SemaforoColor> = {};
    choferes.forEach((ch) => { map[ch.uid] = "verde"; });
    anomalias.forEach((a) => {
      if (!a.choferId) return;
      if (a.severity === "rojo") map[a.choferId] = "rojo";
      else if (map[a.choferId] === "verde") map[a.choferId] = "amarillo";
    });
    return map;
  }, [anomalias, choferes]);

  // Auto-enviar Telegram cuando se detectan anomalías (una vez por sesión)
  useEffect(() => {
    if (anomalias.length > 0 && !sentRef.current) {
      sentRef.current = true;
      enviarTelegram(anomalias, false);
    }
  }, [anomalias]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviarTelegram = async (anom: Anomalia[], feedback = true) => {
    if (feedback) setTgLoading(true);
    const lines = [
      `🚨 *Motor de Anomalías — Polar Breeze*`,
      `📅 ${new Date().toLocaleDateString("es-MX")}`,
      ``,
      `*${anom.length} anomalía${anom.length !== 1 ? "s" : ""} detectada${anom.length !== 1 ? "s" : ""}*`,
    ];
    anom.forEach((a) => {
      const cfg = TIPO_CFG[a.tipo];
      lines.push(`\n${cfg.icon} *${cfg.label}* — ${a.choferNombre}`);
      lines.push(`  ${a.descripcion}`);
    });
    try {
      await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lines.join("\n"),
          level: anom.some((a) => a.severity === "rojo") ? "error" : "warning",
        }),
      });
      if (feedback) setTgMsg("✅ Notificación enviada por Telegram");
    } catch {
      if (feedback) setTgMsg("❌ Error al enviar Telegram");
    } finally {
      if (feedback) {
        setTgLoading(false);
        setTimeout(() => setTgMsg(null), 4000);
      }
    }
  };

  // ── Análisis profundo con Claude API ──────────────────────────────────────
  const analizarConClaude = async () => {
    setIaLoading(true);
    setIaAnalisis(null);
    setIaModalOpen(true);

    // Construir resumen del estado actual para enviar a la IA
    const resumenAnomAlias = anomalias.map((a) =>
      `- [${TIPO_CFG[a.tipo].label}] ${a.choferNombre}: ${a.descripcion}`
    ).join("\n");

    const resumenImb15 = imb15.reduce((map, r) => {
      const k = r.choferNombre;
      if (!map[k]) map[k] = { entr: 0, carg: 0 };
      map[k].entr += r.cantidadEntregada ?? 0;
      map[k].carg += r.cantidadCargada   ?? 0;
      return map;
    }, {} as Record<string, { entr: number; carg: number }>);

    const resumenChoferes = Object.entries(resumenImb15)
      .map(([nom, d]) => `${nom}: ${d.entr}/${d.carg} uds (${d.carg > 0 ? ((d.entr/d.carg)*100).toFixed(0) : "—"}%)`)
      .join(", ");

    const prompt = `Eres un experto en detección de fraude y análisis de anomalías para distribuidoras de helados.

CONTEXTO: Polar Breeze, S.R.L. — distribuidora en Santiago, Rep. Dom.
FECHA: ${new Date().toLocaleDateString("es-DO")}

ANOMALÍAS DETECTADAS HOY (${anomalias.length}):
${resumenAnomAlias || "Ninguna detectada por el motor de reglas."}

RENDIMIENTO CHOFERES (últimos 15 días):
${resumenChoferes || "Sin datos suficientes."}

META DE PUNTOS: ${meta}

INSTRUCCIONES:
1. Analiza los patrones de las anomalías detectadas.
2. Identifica cuáles choferes merecen mayor atención y por qué.
3. Detecta si hay patrones recurrentes que podrían indicar manipulación.
4. Da recomendaciones concretas al administrador.
5. Clasifica el riesgo general: BAJO / MEDIO / ALTO / CRÍTICO.

Responde en español dominicano, formato claro con secciones.`;

    try {
      const res = await fetch("/api/analyze", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tipo: "anomalias", texto: prompt }),
      });
      const data = await res.json() as { resultado?: string; error?: string };
      setIaAnalisis(data.resultado ?? data.error ?? "Sin respuesta del motor IA.");
    } catch (e) {
      setIaAnalisis(`Error al conectar con Claude API: ${String(e)}`);
    } finally {
      setIaLoading(false);
    }
  };

  const filtradas = filtro === "todas" ? anomalias : anomalias.filter((a) => a.tipo === filtro);
  const chofActivos = choferes.filter((c) => c.activo !== false);

  return (
    <div className="space-y-5">

      {/* ── Header + Telegram ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-800 text-lg">⚠️ Motor de Anomalías</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Detección automática · {anomalias.length > 0
              ? `${anomalias.length} alerta${anomalias.length !== 1 ? "s" : ""} activa${anomalias.length !== 1 ? "s" : ""}`
              : "Todo normal"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tgMsg && (
            <span className="text-xs text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">{tgMsg}</span>
          )}
          {/* Botón Analizar con IA */}
          <button
            onClick={analizarConClaude}
            disabled={iaLoading}
            className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-gray-800 active:scale-95
              text-white rounded-lg text-sm font-medium transition-all duration-100 disabled:opacity-50"
          >
            {iaLoading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : "🤖"}
            Analizar con IA
          </button>
          <button
            onClick={() => enviarTelegram(anomalias)}
            disabled={tgLoading || anomalias.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95
              text-white rounded-lg text-sm font-medium transition-all duration-100 disabled:opacity-50"
          >
            {tgLoading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : "📨"}
            Notificar Telegram
          </button>
        </div>
      </div>

      {/* ── Semáforo por chofer ── */}
      {chofActivos.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-3 text-sm">Semáforo por chofer (hoy)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {chofActivos.map((ch) => {
              const sem = semaforoPorChofer[ch.uid] ?? "verde";
              const cfg = SEM_CFG[sem];
              const mis = anomalias.filter((a) => a.choferId === ch.uid);
              return (
                <div
                  key={ch.uid}
                  className={`${cfg.bg} ring-2 ${cfg.ring} rounded-xl p-3 flex flex-col gap-2`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center
                      text-white font-bold text-sm bg-gray-400`}>
                      {ch.nombre.charAt(0).toUpperCase()}
                    </div>
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-800 truncate">{ch.nombre}</p>
                    <p className="text-xs text-gray-500">{cfg.label}</p>
                    {mis.length > 0 && (
                      <p className="text-xs text-red-600 mt-0.5">
                        {mis.length} alerta{mis.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => setFiltro("todas")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 active:scale-95 ${
            filtro === "todas" ? "bg-gray-800 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
          }`}
        >
          Todas ({anomalias.length})
        </button>
        {(Object.keys(TIPO_CFG) as AnomaliaType[]).map((tipo) => {
          const cfg = TIPO_CFG[tipo];
          const cnt = anomalias.filter((a) => a.tipo === tipo).length;
          if (cnt === 0) return null;
          return (
            <button
              key={tipo}
              onClick={() => setFiltro(tipo)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-100 active:scale-95 ${
                filtro === tipo
                  ? "bg-gray-800 text-white"
                  : `${cfg.bg} ${cfg.text} border ${cfg.border} hover:brightness-95`
              }`}
            >
              {cfg.icon} {cfg.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* ── Lista de anomalías ── */}
      {filtradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">{anomalias.length === 0 ? "✅" : "🔍"}</p>
          <p className="font-medium text-gray-600">
            {anomalias.length === 0
              ? "Sin anomalías detectadas hoy"
              : "Sin anomalías para este filtro"}
          </p>
          {anomalias.length === 0 && (
            <p className="text-xs mt-2 text-gray-300">
              El sistema monitorea: sobreventas, complementaciones, mínimos de puntos y ventas bajas.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map((a) => {
            const cfg = TIPO_CFG[a.tipo];
            return (
              <div
                key={a.id}
                className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 flex items-start gap-3`}
              >
                <span className="text-2xl flex-shrink-0">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      a.severity === "rojo"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {a.severity === "rojo" ? "🚨 Crítico" : "⚠️ Revisión"}
                    </span>
                  </div>
                  <p className={`font-bold text-sm ${cfg.text}`}>{a.choferNombre}</p>
                  <p className="text-sm text-gray-700 mt-1">{a.descripcion}</p>
                </div>
                {a.timestamp.getTime() > 0 && a.tipo !== "complementacion" && a.tipo !== "minimo_puntos" && a.tipo !== "venta_baja" && (
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                    {fmtDate(a.timestamp)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Explicación de reglas ── */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-600 mb-2">📖 Reglas del motor</p>
        {(Object.entries(TIPO_CFG) as [AnomaliaType, typeof TIPO_CFG[AnomaliaType]][]).map(([tipo, cfg]) => (
          <div key={tipo} className="flex items-start gap-2">
            <span className="text-base flex-shrink-0">{cfg.icon}</span>
            <div>
              <p className="text-xs font-medium text-gray-700">{cfg.label}</p>
              <p className="text-xs text-gray-400">
                {tipo === "sobreventado"    && "Entregado > Cargado en cualquier registro del día."}
                {tipo === "complementacion" && "Dos choferes con diferencias que se cancelan (±5+ uds, suma ≤ 2)."}
                {tipo === "minimo_puntos"   && `≥3 días en zona [meta×0.9 – meta×1.1], más del 60% de días activos.${meta > 0 ? ` Meta actual: ${meta} pts.` : " Sin meta configurada."}`}
                {tipo === "venta_baja"      && "Venta de hoy < 60% del promedio histórico (base mínima: 5 días, promedio > 10 uds)."}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal análisis IA ── */}
      {iaModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIaModalOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
            style={{ maxHeight: "min(80vh, 640px)" }}>

            {/* Header */}
            <div className="px-5 py-4 flex items-center gap-3 flex-shrink-0"
              style={{ background: "linear-gradient(90deg, #1A1A1A 0%, #2d2d2d 100%)" }}>
              <span className="text-2xl">🤖</span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm">Análisis profundo con IA</p>
                <p className="text-white/50 text-[10px]">
                  {new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                </p>
              </div>
              <button
                onClick={() => setIaModalOpen(false)}
                className="text-white/60 hover:text-white text-xl leading-none transition-colors"
              >✕</button>
            </div>

            {/* Banda tricolor */}
            <div className="flex h-[3px] flex-shrink-0">
              <div className="flex-1 bg-[#F5C800]" />
              <div className="flex-1 bg-[#D42B2B]" />
              <div className="flex-1 bg-[#1E8C3A]" />
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto p-5">
              {iaLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="w-10 h-10 border-4 border-[#F5C800]/30 border-t-[#F5C800] rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Analizando anomalías con IA…</p>
                  <p className="text-xs text-gray-300">Esto puede tardar unos segundos</p>
                </div>
              ) : iaAnalisis ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                    {iaAnalisis}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">Sin análisis disponible.</p>
              )}
            </div>

            {/* Footer */}
            {!iaLoading && iaAnalisis && (
              <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center flex-shrink-0 bg-gray-50/50">
                <p className="text-xs text-gray-400">Motor: Claude API · Polar Breeze Hub</p>
                <button
                  onClick={() => setIaModalOpen(false)}
                  className="px-4 py-2 bg-[#1A1A1A] hover:bg-gray-800 text-white text-xs font-medium
                    rounded-lg transition-all active:scale-95"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
