# CHANGELOG — Polar Breeze Hub

> ⚠️ **LEE ESTE ARCHIVO AL INICIO DE CADA SESIÓN Y ACTUALÍZALO ANTES DE HACER PUSH. Si agregas una mejora márcala ⏳, si la completas márcala ✅.**

Historial de cambios. Formato inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/). Orden cronológico inverso (lo más reciente arriba). La hoja de ruta de mejoras está en `MEJORAS.md`.

<!-- NUEVAS ENTRADAS ARRIBA -->
## Sin publicar

### Corregido
- **Tab Choferes del Encargado** crasheaba (TypeError) si un talonario "retirada" no tenía el array `productos`; se blindaron las useMemo `ranking`/`invHoy`. (`827ca54`)

### Añadido
- **Fotos del catálogo** en `assets/fotos/productos/`: `paletas/` (16) y `helados/` (12), con `README.md` y convención de nombres por producto. Nombres de archivo **normalizados** (minúsculas, sin tildes ni espacios → guiones) y corregidos typos (bainilla→vainilla, frasa→fresa). `logo.jpg` movido a `assets/fotos/marca/`.

### Cambiado
- **Tabs del Encargado**: la fila de tabs se separa de la fila de arriba (padding superior + margen + divisor sutil) para que respire. (Mejora #12)
- **Registro de Lotes**: el sombreado de la sub-área **Entrada** pasa a **azul** (header, paneles y campos de captura) para diferenciarla de la **lista de productos** (verde). El botón 📥 Entrada del sub-toggle también es azul. (Mejora #11)

---

## 2026-06-14

### Añadido
- **PWA con comportamiento nativo**: el Hub Admin pasa a ser PWA completa (Service Worker + banner de instalación), el ChoferDashboard suma su banner de instalación, y los shortcuts del manifest abren el tab correcto vía deep-link `?tab=` (Encargado y Despachador). La infra base (manifests por área, íconos, SW, página offline) ya existía. (Mejora #10 · `6388f9d`)
- **Módulo de reposición inteligente** (tab ♻️ Reposición del Encargado): sugiere reponer por mínimo manual por producto (pedir = mín − stock), con estados crítico/bajo/ok, consumo diario reciente y cobertura como ayuda, y Compartir pedido a BON por WhatsApp. Mínimos en `localStorage` (`pb_minimos`). (Mejora #9 · `ff74e6c`)
- **Salidas manuales del Encargado en Hub Admin**: el detalle de cada encargado (tab Encargados) muestra sus salidas manuales (picking + despacho directo), atribuidas por `responsableId`. (Mejora #8 · `aec0e9f`)
- **Despacho directo Encargado → chofer**: botón 🚚 por chofer en el tab Choferes que abre un modal (`DespachoChofer.tsx`) para entregar productos del stock; escribe `salida_despacho` con `choferId`/`choferNombre` y cantidad negativa → descuenta del loker y queda atribuido al chofer. (Mejora #7 · `c467981`)
- **Tab Urgente dedicado** en Stock del Encargado: productos críticos (saldo ≤ 0) con badge rojo en vivo (activo desde que abre el dashboard) y Compartir por WhatsApp. (Mejora #2 · `cdca4e6`)
- **Tab 🗂️ Guardados**: historial de lotes (`lotes_loker`) con búsqueda por fecha, filas expandibles (productos, factura, registrado por, notas) y Compartir por WhatsApp. Componente nuevo `LotesGuardados.tsx`. (Mejora #3 · `66b6fa2`)
- **Persistencia del tema** claro/oscuro en la App Inventario (`polar-breeze-final.html`): se guarda en `localStorage` (`pb_theme`) y se restaura al cargar. (`ec986fb`)
- **Impresión "solo contenido relevante"**: convención opt-in de clases `.no-print` / `.pb-print-band` / `.pb-print-flat` aplicada a las tarjetas del Encargado (oculta controles de acción y aplana adornos para ahorrar tinta). (Mejora #4 · `a528c88`)
- **Revisión/sincronización manual por chofer** (tab Choferes): botón 🔄 por chofer que lo marca como revisado ese día → chip, fila y punto lateral en azul + contador. Persistido por fecha en `localStorage` (`pb_revisados_<fecha>`). No conecta con Sheets. (Mejora #5 · `d5f6767`)
- **Salidas por picking** en el Encargado: el tab Lote se divide en 📥 Entrada (registro de lotes BON, sin cambios) y 📤 Salida (Picking). El picking lee el stock en vivo y escribe movimientos negativos (`salida_despacho` / `retiro_despacho` / `motivo: picking`) que descuentan del loker. Componente nuevo `SalidaPicking.tsx`. (Mejora #6 · `2ba2bea`)

### Corregido
- **Impresión**: se revirtió una regla `@media print` global (`input, select, textarea { display:none }`) que neutralizaba la impresión de los valores de formularios en toda la app (Despachador/Admin). La depuración de impresión sigue por clases opt-in. (`45d0c23`)

### Documentación
- Hoja de ruta de mejoras (#1–#14) en `MEJORAS.md` y este `CHANGELOG.md`.
- `CLAUDE.md` alineado con el flujo real (push directo a `main`, sin PR; gates `tsc` + `build`). (`92da2db`)
- `CONTEXT.md` actualizado: tabs del Encargado, convención de impresión, picking y revisión manual.

---

## 2026-06-13

### Añadido
- **Alarma visual**: las filas de stock negativo parpadean en rojo en el Encargado y en el Hub Admin. (Mejora #1 · `c50ee3b`)
