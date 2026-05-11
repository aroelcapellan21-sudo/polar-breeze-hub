"use client";

import React from "react";

interface State { hasError: boolean; error: string }

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: `${error.name}: ${error.message}` };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    const fn = componentStack.split("\n")[1]?.trim() ?? "desconocido";
    const win = typeof window !== "undefined" ? window.location.pathname : "servidor";

    fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level:   "error",
        window:  win,
        fn,
        message: `${error.name}: ${error.message}\n\n${componentStack.slice(0, 600)}`,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">
            <p className="text-5xl">💥</p>
            <h1 className="text-xl font-bold text-gray-800">Algo salió mal</h1>
            <p className="text-sm text-gray-500">{this.state.error}</p>
            <p className="text-xs text-gray-400">Se notificó al equipo por Telegram.</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: "" }); window.location.reload(); }}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white py-2.5 rounded-xl font-medium transition-all duration-100"
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
