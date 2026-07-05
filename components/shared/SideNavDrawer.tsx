"use client";

export type NavColor = "amarillo" | "rojo" | "verde";

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

const COLOR_BG: Record<NavColor, string> = {
  amarillo: "rgba(245,200,0,0.15)",
  rojo: "rgba(212,43,43,0.15)",
  verde: "rgba(30,140,58,0.15)",
};

interface Props {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
  activeKey: string;
  onSelect: (key: string) => void;
  roleLabel?: string;
}

export default function SideNavDrawer({ open, onClose, sections, activeKey, onSelect, roleLabel }: Props) {
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
          flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header del panel */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#1D4ED8] flex-shrink-0">
          <h2 className="text-white font-bold text-base">{roleLabel ?? "Menú"}</h2>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white text-2xl leading-none active:scale-95 transition-all duration-100"
          >
            ×
          </button>
        </div>

        {/* Secciones */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 bg-gray-50/50">
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
                          style={{ background: COLOR_BG[section.color] }}
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
        </div>

        {/* Banda tricolor decorativa */}
        <div className="flex h-[5px] flex-shrink-0">
          <div className="flex-1 bg-[#F5C800]" />
          <div className="flex-1 bg-[#D42B2B]" />
          <div className="flex-1 bg-[#1E8C3A]" />
        </div>
      </div>
    </>
  );
}
