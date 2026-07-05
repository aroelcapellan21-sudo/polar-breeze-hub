"use client";

export type NavColor = "amarillo" | "rojo" | "verde" | "azul";

export interface NavItem {
  key: string;
  icon: string;
  label: string;
  badge?: string;
}

export interface NavSection {
  title: string;
  color: NavColor;
  items: NavItem[];
}

const COLOR_GRADIENT: Record<NavColor, string> = {
  amarillo: "linear-gradient(135deg, rgba(245,200,0,0.35), rgba(245,200,0,0.10))",
  rojo:     "linear-gradient(135deg, rgba(212,43,43,0.35), rgba(212,43,43,0.10))",
  verde:    "linear-gradient(135deg, rgba(30,140,58,0.35), rgba(30,140,58,0.10))",
  azul:     "linear-gradient(135deg, rgba(59,130,246,0.35), rgba(59,130,246,0.10))",
};

interface Props {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
  activeKey: string;
  onSelect: (key: string) => void;
  roleLabel?: string;
  userName?: string;
  userRoleLabel?: string;
  onLogout?: () => void;
  headerColor?: string;
}

export default function SideNavDrawer({
  open, onClose, sections, activeKey, onSelect, roleLabel, userName, userRoleLabel, onLogout, headerColor,
}: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Panel */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-[85%] max-w-[360px] bg-white shadow-2xl
          rounded-r-[24px] overflow-hidden flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header del panel */}
        <div className="flex-shrink-0" style={{ background: headerColor ?? "#1D4ED8" }}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shadow-md ring-1 ring-white/20"
                style={{ background: "linear-gradient(135deg, #F5C800 33%, #D42B2B 33% 66%, #1E8C3A 66%)" }}
              >
                <span className="text-sm">🧊</span>
              </div>
              <h2 className="text-white font-bold text-base">{roleLabel ?? "Menú"}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white text-2xl leading-none active:scale-95 transition-all duration-100"
            >
              ×
            </button>
          </div>
          {(userName || userRoleLabel) && (
            <div className="px-5 pb-3 text-white/80 text-xs font-medium">
              {userName}{userName && userRoleLabel ? " · " : ""}{userRoleLabel}
            </div>
          )}
          {/* Banda tricolor */}
          <div className="flex h-[4px]">
            <div className="flex-1 bg-[#F5C800]" />
            <div className="flex-1 bg-[#D42B2B]" />
            <div className="flex-1 bg-[#1E8C3A]" />
          </div>
        </div>

        {/* Secciones */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4 space-y-6"
          style={{
            background: "linear-gradient(180deg, rgba(245,200,0,.04), rgba(212,43,43,.04), rgba(30,140,58,.04)), #FFFFFF",
          }}
        >
          {sections.map((section) => (
            <div key={section.title}>
              <p className="text-gray-400 text-xs font-bold tracking-widest uppercase mb-2.5 px-1">
                {section.title}
              </p>
              <div className="flex flex-col gap-3">
                {section.items.map((item) => {
                  const isActive = item.key === activeKey;
                  return (
                    <button
                      key={item.key}
                      onClick={() => { onSelect(item.key); onClose(); }}
                      className={`w-full flex items-center justify-between gap-3 rounded-[20px] p-4
                        border-l-[3px] transition-all duration-150 active:scale-[0.98] shadow-[0_1px_3px_rgba(0,0,0,0.06)] ${
                        isActive
                          ? "border-[#3B82F6] bg-[rgba(59,130,246,0.1)]"
                          : "border-transparent bg-white ring-1 ring-gray-100 hover:shadow-md"
                      }`}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div
                          className="w-10 h-10 rounded-[14px] flex items-center justify-center text-lg flex-shrink-0"
                          style={{ background: COLOR_GRADIENT[section.color] }}
                        >
                          {item.icon}
                        </div>
                        <span className="font-semibold text-[15px] text-[#1A1A1A] truncate">
                          {item.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.badge && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                            {item.badge}
                          </span>
                        )}
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[#F5C800] text-xs font-bold">
                          ⟩
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {onLogout && (
            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={() => { onLogout(); onClose(); }}
                className="w-full flex items-center gap-3 rounded-[20px] p-4 mt-4
                  text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all duration-150 active:scale-[0.98]"
              >
                <span className="text-lg">🚪</span>
                <span className="font-semibold text-[15px]">Cerrar sesión</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
