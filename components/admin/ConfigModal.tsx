"use client";

import { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from "firebase/auth";
import { FsConfig, PuntosConfig, PuntoProducto } from "@/lib/types";

const API_KEY  = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

async function restSignIn(email: string, password: string) {
  const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json() as Promise<{ idToken?: string; error?: { message: string } }>;
}

async function restUpdatePassword(idToken: string, newPassword: string) {
  const r = await fetch(`${AUTH_URL}:update?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, password: newPassword, returnSecureToken: true }),
  });
  return r.json() as Promise<{ error?: { message: string } }>;
}

type Section = "passwords" | "config" | "telegram" | "puntos";

export default function ConfigModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("passwords");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ── Passwords ────────────────────────────────────────────────────────────────
  const [adminCur, setAdminCur]     = useState("");
  const [adminNew, setAdminNew]     = useState("");
  const [adminNew2, setAdminNew2]   = useState("");
  const [desCur, setDesCur]         = useState("");
  const [desNew, setDesNew]         = useState("");
  const [desNew2, setDesNew2]       = useState("");
  const [pwLoading, setPwLoading]   = useState(false);

  // ── Config ───────────────────────────────────────────────────────────────────
  const [cfg, setCfg]     = useState<FsConfig>({});
  const [cfgLoad, setCfgLoad] = useState(false);

  // ── Telegram ─────────────────────────────────────────────────────────────────
  const [tgToken, setTgToken] = useState("");
  const [tgChat,  setTgChat]  = useState("");
  const [tgLock,  setTgLock]  = useState(true);
  const [tgPwd,   setTgPwd]   = useState("");

  // ── Puntos ───────────────────────────────────────────────────────────────────
  const [puntos, setPuntos]   = useState<PuntoProducto[]>([]);
  const [meta,   setMeta]     = useState(100);
  const [puntosLock, setPuntosLock] = useState(true);
  const [puntosPwd,  setPuntosPwd]  = useState("");

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // Load config/main on mount
  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, "config", "main"));
      if (snap.exists()) {
        const data = snap.data() as FsConfig;
        setCfg(data);
        if (data.telegramToken) setTgToken(data.telegramToken as string);
        if (data.telegramChatId) setTgChat(data.telegramChatId as string);
      }
      const pSnap = await getDoc(doc(db, "config", "puntos"));
      if (pSnap.exists()) {
        const pd = pSnap.data() as PuntosConfig;
        setPuntos(pd.productos ?? []);
        setMeta(pd.meta ?? 100);
      }
    }
    load();
  }, []);

  // ── Cambiar contraseña Admin ─────────────────────────────────────────────────
  const handleAdminPw = async () => {
    if (adminNew !== adminNew2) { flash("err", "Las contraseñas no coinciden"); return; }
    if (adminNew.length < 3)    { flash("err", "Mínimo 3 caracteres"); return; }
    setPwLoading(true);
    try {
      const user = auth.currentUser;
      if (!user?.email) throw new Error("Sin sesión");
      const cred = EmailAuthProvider.credential(user.email, adminCur);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, adminNew);
      flash("ok", "Contraseña Admin actualizada ✓");
      setAdminCur(""); setAdminNew(""); setAdminNew2("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setPwLoading(false);
    }
  };

  // ── Cambiar contraseña Despachador ───────────────────────────────────────────
  const handleDesPw = async () => {
    if (desNew !== desNew2) { flash("err", "Las contraseñas no coinciden"); return; }
    if (desNew.length < 3)  { flash("err", "Mínimo 3 caracteres"); return; }
    setPwLoading(true);
    try {
      const signIn = await restSignIn("despachador@polarbreeze.com", desCur);
      if (signIn.error) throw new Error("Contraseña actual incorrecta");
      const upd = await restUpdatePassword(signIn.idToken!, desNew);
      if (upd.error) throw new Error(upd.error.message);
      flash("ok", "Contraseña Despachador actualizada ✓");
      setDesCur(""); setDesNew(""); setDesNew2("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setPwLoading(false);
    }
  };

  // ── Guardar config ───────────────────────────────────────────────────────────
  const saveConfig = async () => {
    setCfgLoad(true);
    try {
      await setDoc(doc(db, "config", "main"), {
        ...cfg,
        ...(tgToken && { telegramToken: tgToken }),
        ...(tgChat  && { telegramChatId: tgChat }),
      }, { merge: true });
      flash("ok", "Configuración guardada ✓");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error");
    } finally {
      setCfgLoad(false);
    }
  };

  // ── Unlock Telegram config ───────────────────────────────────────────────────
  const unlockTelegram = async () => {
    const user = auth.currentUser;
    if (!user?.email) return;
    try {
      const cred = EmailAuthProvider.credential(user.email, tgPwd);
      await reauthenticateWithCredential(user, cred);
      setTgLock(false); setTgPwd("");
    } catch {
      flash("err", "Contraseña Admin incorrecta");
    }
  };

  // ── Unlock puntos config ─────────────────────────────────────────────────────
  const unlockPuntos = async () => {
    const user = auth.currentUser;
    if (!user?.email) return;
    try {
      const cred = EmailAuthProvider.credential(user.email, puntosPwd);
      await reauthenticateWithCredential(user, cred);
      setPuntosLock(false); setPuntosPwd("");
    } catch {
      flash("err", "Contraseña Admin incorrecta");
    }
  };

  const savePuntos = async () => {
    try {
      await setDoc(doc(db, "config", "puntos"), { productos: puntos, meta });
      flash("ok", "Puntos guardados ✓");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Error");
    }
  };

  const SECTIONS: { key: Section; label: string; icon: string }[] = [
    { key: "passwords", label: "Contraseñas",  icon: "🔑" },
    { key: "config",    label: "Config",        icon: "🏢" },
    { key: "telegram",  label: "Telegram",      icon: "🤖" },
    { key: "puntos",    label: "Puntos",        icon: "⭐" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-800 text-lg">⚙️ Configuración del Sistema</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl active:scale-95 transition-all duration-100 leading-none"
          >
            ×
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b flex-shrink-0 px-2">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all
                duration-100 border-b-2 -mb-px active:scale-95 ${
                section === s.key
                  ? "border-purple-600 text-purple-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Contraseñas ── */}
          {section === "passwords" && (
            <div className="space-y-5">
              <PwBlock
                title="👑 Contraseña Admin"
                curLabel="Contraseña actual"
                cur={adminCur} setCur={setAdminCur}
                nw={adminNew}  setNw={setAdminNew}
                nw2={adminNew2} setNw2={setAdminNew2}
                loading={pwLoading}
                onSave={handleAdminPw}
              />
              <PwBlock
                title="🚛 Contraseña Despachador"
                curLabel="Contraseña actual del Despachador"
                cur={desCur} setCur={setDesCur}
                nw={desNew}  setNw={setDesNew}
                nw2={desNew2} setNw2={setDesNew2}
                loading={pwLoading}
                onSave={handleDesPw}
              />
            </div>
          )}

          {/* ── Config general ── */}
          {section === "config" && (
            <div className="space-y-4">
              <Field label="Nombre de empresa" value={(cfg.nombreEmpresa as string) ?? ""}
                onChange={(v) => setCfg((p) => ({ ...p, nombreEmpresa: v }))} />
              <Field label="Moneda" value={(cfg.moneda as string) ?? "MXN"}
                onChange={(v) => setCfg((p) => ({ ...p, moneda: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Umbral ⚠️ (%)" type="number"
                  value={String(cfg.alertaWarning ?? 5)}
                  onChange={(v) => setCfg((p) => ({ ...p, alertaWarning: Number(v) }))} />
                <Field label="Umbral 🚨 (%)" type="number"
                  value={String(cfg.alertaCritical ?? 15)}
                  onChange={(v) => setCfg((p) => ({ ...p, alertaCritical: Number(v) }))} />
              </div>
              <button
                onClick={saveConfig}
                disabled={cfgLoad}
                className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
                  py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
              >
                {cfgLoad ? "Guardando..." : "Guardar Configuración"}
              </button>
            </div>
          )}

          {/* ── Telegram ── */}
          {section === "telegram" && (
            <div className="space-y-4">
              {tgLock ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Ingresa tu contraseña Admin para ver/editar la config de Telegram.</p>
                  <input
                    type="password" value={tgPwd} onChange={(e) => setTgPwd(e.target.value)}
                    placeholder="Contraseña Admin"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <button
                    onClick={unlockTelegram} disabled={!tgPwd}
                    className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
                      py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
                  >
                    🔓 Desbloquear
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Bot Token" value={tgToken} onChange={setTgToken}
                    placeholder="123456:AAB..." />
                  <Field label="Chat ID" value={tgChat} onChange={setTgChat}
                    placeholder="-100123456789" />
                  <p className="text-xs text-gray-400">
                    Crea un bot con @BotFather en Telegram. El Chat ID puede ser un grupo o canal donde el bot esté agregado.
                  </p>
                  <button
                    onClick={saveConfig}
                    className="w-full bg-green-600 hover:bg-green-700 active:scale-95 text-white
                      py-2.5 rounded-lg text-sm font-semibold transition-all duration-100"
                  >
                    Guardar Telegram
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Puntos ── */}
          {section === "puntos" && (
            <div className="space-y-4">
              {puntosLock ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Ingresa tu contraseña Admin para editar puntos por producto.</p>
                  <input
                    type="password" value={puntosPwd} onChange={(e) => setPuntosPwd(e.target.value)}
                    placeholder="Contraseña Admin"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <button
                    onClick={unlockPuntos} disabled={!puntosPwd}
                    className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
                      py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
                  >
                    🔓 Desbloquear
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Field label="Meta de puntos por quincena" type="number"
                    value={String(meta)} onChange={(v) => setMeta(Number(v))} />
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700">Puntos por producto</p>
                      <button
                        onClick={() => setPuntos((p) => [...p, { nombre: "", puntos: 1 }])}
                        className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                      >
                        + Agregar
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {puntos.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            value={p.nombre}
                            onChange={(e) => {
                              const next = [...puntos];
                              next[i] = { ...next[i], nombre: e.target.value };
                              setPuntos(next);
                            }}
                            placeholder="Producto"
                            className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-purple-400"
                          />
                          <input
                            type="number"
                            value={p.puntos}
                            onChange={(e) => {
                              const next = [...puntos];
                              next[i] = { ...next[i], puntos: Number(e.target.value) };
                              setPuntos(next);
                            }}
                            className="w-20 px-2 py-1.5 border border-gray-200 rounded text-sm text-right outline-none focus:ring-1 focus:ring-purple-400"
                          />
                          <span className="text-xs text-gray-400">pts</span>
                          <button
                            onClick={() => setPuntos((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-400 text-lg"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={savePuntos}
                    className="w-full bg-yellow-500 hover:bg-yellow-600 active:scale-95 text-white
                      py-2.5 rounded-lg text-sm font-semibold transition-all duration-100"
                  >
                    ⭐ Guardar Puntos
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer message */}
        {msg && (
          <div className={`mx-5 mb-4 text-sm px-3 py-2 rounded-lg flex-shrink-0 ${
            msg.type === "ok"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

function PwBlock({
  title, curLabel, cur, setCur, nw, setNw, nw2, setNw2, loading, onSave,
}: {
  title: string; curLabel: string;
  cur: string; setCur: (v: string) => void;
  nw: string;  setNw:  (v: string) => void;
  nw2: string; setNw2: (v: string) => void;
  loading: boolean; onSave: () => void;
}) {
  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3">
      <p className="font-semibold text-gray-700 text-sm">{title}</p>
      <Field label={curLabel} value={cur} onChange={setCur} type="password" placeholder="••••••••" />
      <Field label="Nueva contraseña (mín. 3)" value={nw} onChange={setNw} type="password" placeholder="••••••••" />
      <Field label="Confirmar nueva" value={nw2} onChange={setNw2} type="password" placeholder="••••••••" />
      <button
        onClick={onSave}
        disabled={loading || !cur || !nw || !nw2 || nw.length < 3}
        className="w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white
          py-2.5 rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-60"
      >
        {loading ? "Actualizando..." : "Cambiar contraseña"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "", type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800
          outline-none focus:ring-2 focus:ring-purple-400"
      />
    </div>
  );
}
