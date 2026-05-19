export function pbHeader(): string {
  const now = new Date();
  const fecha = now.toLocaleDateString("es-DO", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const hora = now.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
  return `🧊 *POLAR BREEZE, S.R.L.*\n_${fecha} · ${hora}_`;
}

export function pbFooter(): string {
  return `_Generado por Sistema Polar Breeze Hub_\n_809-923-9010_`;
}
