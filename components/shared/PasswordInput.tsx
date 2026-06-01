"use client";

import { useState, InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Input de contraseña con botón ojito para mostrar/ocultar el texto. */
export default function PasswordInput({ className = "", ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
          hover:text-gray-600 active:scale-90 transition-all"
      >
        {visible ? (
          /* Ojo cerrado */
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
              a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4
              c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19
              m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          /* Ojo abierto */
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}
