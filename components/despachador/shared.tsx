"use client";

import { ProductoItem } from "@/lib/types";
import { ShareBar } from "@/components/shared/ShareButtons";

// ── ImageUploader — cámara en móvil, archivo en PC ────────────────────────────
interface ImageUploaderProps {
  preview: string | null;
  onFile: (base64: string, mimeType: string, preview: string) => void;
  onClear: () => void;
}

export function ImageUploader({ preview, onFile, onClear }: ImageUploaderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const [header, data] = dataUrl.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
      onFile(data, mime, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" className="w-full max-h-64 object-contain rounded-lg border border-gray-200 bg-gray-50" />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-2 right-2 bg-white rounded-full w-7 h-7 flex items-center justify-center
              shadow text-gray-500 hover:text-red-500 active:scale-95 transition-all duration-100 text-lg leading-none"
          >×</button>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Cámara — en móvil abre cámara trasera, en PC abre explorador */}
          <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed
            border-blue-200 rounded-xl py-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50
            active:scale-95 transition-all duration-100">
            <span className="text-2xl mb-1">📷</span>
            <span className="text-xs font-medium text-blue-600">Cámara</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleChange}
            />
          </label>
          {/* Galería / Archivo */}
          <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed
            border-gray-200 rounded-xl py-6 cursor-pointer hover:border-blue-400 hover:bg-gray-50
            active:scale-95 transition-all duration-100">
            <span className="text-2xl mb-1">📁</span>
            <span className="text-xs font-medium text-gray-500">Galería / Archivo</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleChange}
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ── ProductTable — editable, con visto y opción de ocultar precio ─────────────
interface ProductTableProps {
  productos:  ProductoItem[];
  onChange:   (updated: ProductoItem[]) => void;
  showVisto?: boolean;   // default false
  showPrecio?: boolean;  // default true
}

export function ProductTable({ productos, onChange, showVisto = false, showPrecio = true }: ProductTableProps) {
  const update = (i: number, field: keyof ProductoItem, value: string | number | null) => {
    const next = [...productos];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  const remove = (i: number) => onChange(productos.filter((_, idx) => idx !== i));

  const add = () =>
    onChange([...productos, { nombre: "", cantidad: 1, unidad: "cajas" }]);

  const toggleVisto = (i: number, val: "ok" | "mal") => {
    const next = [...productos];
    next[i] = { ...next[i], visto: next[i].visto === val ? null : val };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {productos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b">
                <th className="text-left pb-1.5 pr-2">Producto</th>
                <th className="text-right pb-1.5 pr-2 w-20">Cant.</th>
                <th className="text-left pb-1.5 pr-2 w-24">Unidad</th>
                {showPrecio && <th className="text-right pb-1.5 pr-2 w-20">Precio</th>}
                {showVisto  && <th className="pb-1.5 w-16 text-center">Visto</th>}
                <th className="pb-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {productos.map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input
                      value={p.nombre}
                      onChange={(e) => update(i, "nombre", e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-gray-800
                        focus:ring-1 focus:ring-blue-400 outline-none text-sm"
                      placeholder="Producto"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      value={p.cantidad}
                      onChange={(e) => update(i, "cantidad", Number(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-gray-800
                        focus:ring-1 focus:ring-blue-400 outline-none text-sm text-right"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      value={p.unidad ?? "cajas"}
                      onChange={(e) => update(i, "unidad", e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-gray-700
                        focus:ring-1 focus:ring-blue-400 outline-none text-xs"
                    >
                      {["cajas","bultos","piezas","kg","litros","unidades"].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  {showPrecio && (
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        value={p.precio ?? ""}
                        onChange={(e) => update(i, "precio", e.target.value ? Number(e.target.value) : null)}
                        className="w-full px-2 py-1 border border-gray-200 rounded text-gray-800
                          focus:ring-1 focus:ring-blue-400 outline-none text-sm text-right"
                        placeholder="$"
                      />
                    </td>
                  )}
                  {showVisto && (
                    <td className="py-1 pr-2">
                      <div className="flex gap-1 justify-center">
                        <button
                          type="button"
                          onClick={() => toggleVisto(i, "ok")}
                          className={`text-lg active:scale-90 transition-transform duration-100 leading-none
                            ${p.visto === "ok" ? "opacity-100" : "opacity-25 hover:opacity-60"}`}
                          title="Visto bueno"
                        >✅</button>
                        <button
                          type="button"
                          onClick={() => toggleVisto(i, "mal")}
                          className={`text-lg active:scale-90 transition-transform duration-100 leading-none
                            ${p.visto === "mal" ? "opacity-100" : "opacity-25 hover:opacity-60"}`}
                          title="Visto malo"
                        >❌</button>
                      </div>
                    </td>
                  )}
                  <td className="py-1">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-gray-300 hover:text-red-400 active:scale-95 transition-all duration-100 text-lg leading-none"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs
          text-gray-400 hover:border-blue-300 hover:text-blue-500 active:scale-95
          transition-all duration-100"
      >
        + Agregar producto
      </button>
    </div>
  );
}

// ── ModeToggle ────────────────────────────────────────────────────────────────
export function ModeToggle({
  mode, onChange,
}: {
  mode: "foto" | "manual"; onChange: (m: "foto" | "manual") => void;
}) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-1 gap-1 w-fit">
      {(["foto", "manual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-100 active:scale-95 ${
            mode === m
              ? "bg-white text-blue-700 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {m === "foto" ? "📷 Foto" : "✏️ Manual"}
        </button>
      ))}
    </div>
  );
}

// ── AiButton ─────────────────────────────────────────────────────────────────
export function AiButton({
  onClick, loading, disabled, label = "Analizar con IA",
}: {
  onClick: () => void; loading: boolean; disabled?: boolean; label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700
        active:scale-95 text-white rounded-lg text-sm font-medium transition-all
        duration-100 disabled:opacity-50"
    >
      {loading ? (
        <>
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Analizando...
        </>
      ) : (
        <>✨ {label}</>
      )}
    </button>
  );
}

// ── WhatsAppPrint — delegado a ShareBar (número con memoria localStorage) ──────
export function WhatsAppPrint({ getMessage }: { getMessage: () => string }) {
  return <ShareBar getMessage={getMessage} className="mt-1" />;
}

// ── ProgressSteps — pasos con colores pastel ──────────────────────────────────
export function ProgressSteps({
  steps, current,
}: {
  steps: { label: string }[];
  current: number;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done    = i < current;
        const active  = i === current;
        return (
          <div key={i} className="flex items-center gap-1 flex-shrink-0">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              done   ? "bg-green-100 text-green-700 border border-green-200" :
              active ? "bg-blue-100  text-blue-700  border border-blue-300 ring-1 ring-blue-300" :
                       "bg-gray-100  text-gray-400  border border-gray-200"
            }`}>
              <span>{done ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className={`text-xs ${done ? "text-green-400" : "text-gray-300"}`}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
