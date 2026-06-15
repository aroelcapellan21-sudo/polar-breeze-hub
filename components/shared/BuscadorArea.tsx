"use client";

/**
 * BuscadorArea — Buscador contextual reutilizable por área/tab (Mejora #13).
 *
 * Input de texto que filtra la lista del área en la que está el Encargado.
 * `normalizar` hace la búsqueda insensible a mayúsculas y tildes (inteligente):
 * "platano" encuentra "plátano". Marcado `.no-print` (control de acción).
 */

export function normalizar(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** ¿El texto `q` aparece en cualquiera de los campos (insensible a tildes)? */
export function coincide(q: string, ...campos: (string | number | undefined)[]): boolean {
  const nq = normalizar(q).trim();
  if (!nq) return true;
  return campos.some((c) => c != null && normalizar(String(c)).includes(nq));
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export default function BuscadorArea({ value, onChange, placeholder = "Buscar…", className = "" }: Props) {
  return (
    <div className={`no-print relative ${className}`}>
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg pl-8 pr-8 py-1.5 text-sm text-gray-800
          focus:outline-none focus:ring-2 focus:ring-[#1E8C3A]/30"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Limpiar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
        >
          ✕
        </button>
      )}
    </div>
  );
}
