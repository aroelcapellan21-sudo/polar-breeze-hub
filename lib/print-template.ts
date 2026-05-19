const PB = {
  nombre:    "POLAR BREEZE, S.R.L.",
  direccion: "Calle 2 Esq. 6 No. 11, Altos de Rafey, Santiago",
  telefono:  "809-923-9010",
  rnc:       "1-32-19659-6",
};

const CSS = `
@page { margin: 14mm 12mm; size: letter; }
*     { box-sizing: border-box; margin: 0; padding: 0; }
body  { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111;
        padding-bottom: 36px; }
/* ── Encabezado ── */
.pb-hdr       { position: relative; text-align: center;
                border-bottom: 2.5px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 14px; }
.pb-logo      { font-size: 18px; font-weight: 900; color: #1e3a5f; letter-spacing: -0.3px; }
.pb-info      { font-size: 9px; color: #555; margin-top: 3px; line-height: 1.7; }
.pb-meta      { position: absolute; top: 0; right: 0;
                text-align: right; font-size: 8.5px; color: #777; line-height: 1.6; }
/* ── Título ── */
.pb-title     { font-size: 14px; font-weight: 900; color: #1e3a5f; margin-bottom: 3px; }
.pb-subtitle  { font-size: 10px; color: #555; margin-bottom: 14px; }
/* ── Secciones ── */
.sec-title    { background: #1e3a5f; color: #fff; font-size: 11px; font-weight: 700;
                padding: 5px 9px; margin: 16px 0 7px; border-radius: 2px; }
/* ── Tablas ── */
table         { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
th            { background: #dce8f5; font-weight: 700; text-align: left;
                padding: 5px 7px; border: 1px solid #a8bedb; font-size: 10px; }
td            { padding: 4px 7px; border: 1px solid #ccc; vertical-align: top; }
tr:nth-child(even) td { background: #f5f8fc; }
.tr-total td  { font-weight: 700; background: #cfe2f3 !important;
                border-top: 2px solid #1e3a5f; }
.td-r         { text-align: right; }
.td-c         { text-align: center; }
/* ── Notas / obs ── */
.obs-box      { border: 1px solid #ccc; border-radius: 3px; padding: 7px 9px;
                background: #f9fafb; font-style: italic; margin: 8px 0; }
/* ── Pie de página ── */
.pb-ftr       { position: fixed; bottom: 0; left: 0; right: 0;
                border-top: 1px solid #999; background: #fff;
                display: flex; flex-direction: column; align-items: center;
                gap: 1px; padding: 5px 0; font-size: 8px; color: #666;
                text-align: center; }
.pb-ftr b     { font-weight: 700; color: #1e3a5f; }
@media screen {
  .pb-ftr { position: static; margin-top: 24px; }
}
`;

function nowStrings() {
  const now = new Date();
  const fecha = now.toLocaleDateString("es-DO", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const hora = now.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
  return { fecha, hora };
}

/** Genera el HTML completo de un documento profesional Polar Breeze. */
export function pbPrintDoc(
  title: string,
  subtitle: string,
  bodyHtml: string,
): string {
  const { fecha, hora } = nowStrings();
  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>${title} — ${PB.nombre}</title>
<style>${CSS}</style>
</head><body>
<div class="pb-hdr">
  <div class="pb-meta">Impreso:<br>${fecha}<br>${hora}</div>
  <div class="pb-logo">${PB.nombre}</div>
  <div class="pb-info">
    ${PB.direccion}<br>
    Tel: ${PB.telefono} &nbsp;&nbsp;·&nbsp;&nbsp; RNC: ${PB.rnc}
  </div>
</div>
<div class="pb-title">${title}</div>
${subtitle ? `<div class="pb-subtitle">${subtitle}</div>` : ""}
${bodyHtml}
<div class="pb-ftr">
  <div>Generado por <b>Sistema Polar Breeze Hub</b></div>
  <div><b>NO ACEPTAMOS CAMBIOS NI DEVOLUCIONES</b></div>
  <div>${fecha} · ${hora}</div>
</div>
</body></html>`;
}

/** Abre la ventana de impresión con el HTML dado. */
export function openPrint(html: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

/** Genera una tabla HTML estándar PB. */
export function pbTable(
  headers: string[],
  rows:    (string | number)[][],
  totalRow?: (string | number)[],
): string {
  const ths = headers.map((h) => `<th>${h}</th>`).join("");
  const trs = rows.map((r) =>
    `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`,
  ).join("");
  const tot = totalRow
    ? `<tr class="tr-total">${totalRow.map((c) => `<td>${c}</td>`).join("")}</tr>`
    : "";
  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}${tot}</tbody></table>`;
}
