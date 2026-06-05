# CONTEXT.md — Polar Breeze Hub
# Lee esto ANTES de tocar cualquier archivo
# Versión: 1.1 · Actualizado: 5 Junio 2026

---

## 🚨 REGLA #1 — LA MÁS IMPORTANTE

**Antes de cambiar algo, verifica que funciona.**
**Después de cambiarlo, verifica que sigue funcionando.**
**Si rompes algo al arreglarlo — PARA y revierte antes de continuar.**
**Verificar SIEMPRE en móvil Y desktop antes de hacer commit.**

---

## 📋 QUÉ HACE ESTA APP

Sistema de gestión operativa para Polar Breeze, S.R.L. — distribuidora de helados BON en Santiago, Rep. Dom.

Cuatro roles:
- **Admin** → Oliver (dueño) — control total
- **Despachador** → salida de mercancía y choferes
- **Encargado** (visible como "Supervisor") — inventarios, lotes, stock
- **Chofer** → consulta su inventario del día desde su PWA

---

## 🔥 BUGS ACTIVOS / DEUDA TÉCNICA CRÍTICA

| # | Asunto | Impacto | Acción |
|---|--------|---------|--------|

**Historial de bugs ya corregidos:**

| # | Bug | Commit | Estado |
|---|-----|--------|--------|
| 1 | Botón Salir no aparecía en móvil en Hub Admin | `d93501c` | ✅ |
| 2 | Ver inventario de choferes no funcionaba en desktop | `90d2b39` | ✅ |
| 3 | C.Tiene y C.Vendida invertidos en app inventario | `90d2b39` | ✅ |
| 4 | Deploy Vercel fallando por `middleware.ts` renombrado | `9845f1e` | ✅ |
| 5 | Productos extras no aparecían en detalle de inventario guardado | `2e29efd` | ✅ |
| 6 | Portal solo abría área Encargado — emails hardcodeados en LoginForm | `fbb9a7b` | ✅ |
| 7 | Admin con role="encargado" en Firestore no podía acceder al Hub | `ca23aef` | ✅ Endpoint /api/admin-setup |
| 8 | Buscador Encargado no encontraba "lote" ni "inventario" | `b2f8f41` | ✅ (4 Jun 2026) |
| 9 | FAB imprimía URL/HTML crudo sin estilos Tailwind | `d5626a4` | ✅ (4 Jun 2026) |
| 10 | Reglas Firestore abiertas — cualquier usuario autenticado leía/escribía todo | `eb9974a` | ✅ (5 Jun 2026) — reglas por rol en `firestore.rules` |
| 11 | PIN 1234 hardcoded en polar-breeze-final.html | pendiente | ✅ (5 Jun 2026) — migración Firebase Auth en 3 fases (postMessage relay + Firestore write + eliminar PIN) |
| 12 | /api/admin-setup sin rate limit ni deshabilitación | pendiente | ✅ (5 Jun 2026) — 410 si ADMIN_SETUP_DISABLED=true; rate limit 5/60 s por IP |
| 13 | Telegram webhook sin secret token | pendiente | ✅ (5 Jun 2026) — verifica X-Telegram-Bot-Api-Secret-Token contra TELEGRAM_WEBHOOK_SECRET; fail-safe si no está configurada |
| 14 | GOOGLE_PRIVATE_KEY truncada en Vercel (305 chars) | — | ✅ (5 Jun 2026) — clave RSA completa pegada manualmente en Vercel |

---

## ✅ CONSTRUIDO Y FUNCIONANDO — NO TOCAR SIN AUTORIZACIÓN

### Portal de entrada y rutas por rol

- **Arquitectura de particiones**: cada rol tiene su propia ruta y su propio login.
- Login con email/contraseña + Firebase Auth.
- Admin, Despachador, Encargado: campos email + contraseña libres.
- Chofer: número de ficha (construye email `ficha@chofer.polarbreeze.com`).
- El rol mostrado siempre viene de Firestore (`usuarios/{uid}.role`), nunca del selector del portal.
- Si un usuario queda con rol incorrecto en Firestore → usar `POST /api/admin-setup` con header `x-setup-token: SETUP_SECRET` y body `{email, role, nombre}`.

**Tabla de rutas y acceso:**

| URL corta | URL PWA | Rol | Login que muestra |
|-----------|---------|-----|-------------------|
| `/` | — | admin | Solo login Admin |
| `/despachador` | `/app-despachador` | despachador | Solo login Despachador |
| `/encargado` | `/app-encargado` | encargado | Solo login Encargado |
| `/chofer` | `/app-chofer` | chofer | Solo login Chofer (por ficha) |

- Las rutas cortas son redirects 307 en `next.config.ts` → rutas PWA.
- `LoginForm` acepta prop `modo?: UserRole`: con modo muestra solo el formulario de ese rol, sin selector de 4 bloques, sin botón "← Cambiar rol".
- Cada ruta PWA tiene 3 niveles de guard: spinner → redirect si no autenticado → modal "Acceso restringido" si rol incorrecto → dashboard.
- `app/page.tsx` — 3 comportamientos:
  - No autenticado → muestra `LoginForm modo="admin"`.
  - Autenticado no-admin → `window.location.replace` a su ruta PWA.
  - Autenticado admin → renderiza `AdminDashboard`.
- **NO TOCAR**: `lib/auth-context.tsx`, `lib/firebase.ts`, `lib/types.ts`

### App Despachador

- 6 tabs: Cuarto Frío, Choferes, Comparar, Historial, Cierre, Anomalías.
- Guarda en colecciones: `history`, `talonario`, `drivers`, `movimientos_loker`.
- Tablas de referencia con puntos y precios.
- SPIKINSCAN con escáner HID.
- **NO TOCAR SIN AUTORIZACIÓN**: `components/DespachadorDashboard.tsx`

### App Encargado / Supervisor

- Tabs: Registro de lotes, Choferes, Stock, Vista, Weight.
- Registro de lotes con escáner HID y buscador inteligente de productos.
- Tab Choferes → cierre del día, puntos quincena, inventario despachado.
- Tab Stock → barras de progreso con semáforo de colores.
- Tab Vista → contiene embebida la app `public/polar-breeze-final.html` (App Inventario Choferes).
- Tab Weight → escáner HID + báscula Bluetooth.
- **Buscador global** (`components/encargado/BuscadorGlobal.tsx`): busca en `lotes_loker`, `movimientos_loker` (stock), `usuarios` (choferes) e `inventarios/{fecha}/choferes` (últimos 14 días). Sin `orderBy` en la consulta de lotes (evita requisito de índice Firestore compuesto); cada fetch tiene `.catch()` propio.
- **NO TOCAR SIN AUTORIZACIÓN**: `components/EncargadoDashboard.tsx`

### App Chofer

- Ruta: `/app-chofer` (login en `/chofer` con número de ficha).
- Función única: el chofer consulta su inventario del día (base + extras, totales, puntos de quincena). Solo lectura.
- No reporta sobrantes desde la app — eso lo hace por nota de voz al bot de WhatsApp (ver sección Bot WhatsApp).
- La app y el bot coexisten: app = consulta, bot = reporte.
- **NO TOCAR SIN AUTORIZACIÓN**: `components/ChoferDashboard.tsx` (o el componente equivalente).

### Hub Admin

- KPIs en tiempo real desde Firebase.
- Gráfico de ventas 7 días (SVG puro).
- Ranking TOP 5 choferes.
- Gráfico dona distribución de productos.
- Alertas unificadas en tiempo real (combina `alertas` + `weight_alerts`).
- Tablero de rutas activas por zona.
- Módulo gestión de usuarios (crear, editar, desactivar).
- En móvil el texto del logo ("Polar Breeze / Admin") está oculto (`hidden sm:block`) para liberar espacio en el header; el botón Salir tiene `flex-shrink-0`.
- **Stock del Loker mejorado**: estado general (chip ✅/⚠️/🚨 + contadores verde/amarillo/rojo) y barras de progreso con semáforo tricolor por producto, idéntico al Encargado. Sección en `components/admin/Inventario.tsx`.
- **NO TOCAR SIN AUTORIZACIÓN**: `components/AdminDashboard.tsx`

### Bot Telegram

- Activo en @polarbreeze_monitor_bot.
- Comandos: /estado, /alertas, /choferes, /resumen_hoy.
- Destinatarios: Oliver, Encargado, Despachador.
- **NO TOCAR**: `app/api/telegram-webhook/route.ts`

### Bot WhatsApp (Baileys) — para Choferes

- Función: recibe nota de voz del chofer al cierre del día con el reporte de sobrantes.
- Transcribe (Whisper/Gemini) → parsea cantidades → actualiza Firestore.
- Devuelve resumen formateado al chofer.
- Coexiste con la App Chofer (que solo consulta).

### App Inventario Choferes (HTML embebida)

- Archivo: `public/polar-breeze-final.html`
- Vive dentro del tab Vista del Dashboard del Encargado.
- PIN 1234 hardcoded (ver Deuda C).
- Barra de progreso tricolor, chips de choferes con 3 estados.
- Modo claro/oscuro funcionando solo dentro de esta app embebida (excepción a la regla global de "siempre modo claro").
- Badge ⚠ aparece al escribir en producto fuera del inventario base.
- Productos extras (en rojo) SÍ suman en los totales.
- Modal confirmación muestra pts venta + pts quincena.
- El encargado ingresa **sobrante** (C.Tiene); C.Vendida = base − sobrante.
- Modal de inventario registrado centrado en desktop (max-width 580px).
- Productos extras aparecen en sección "⚠ Extras" dentro del detalle de inventario guardado.
- Detalle: Total RD$ por fila (verde=base, rojo=extra) + totales al pie: Sobrante · Vendido · ⭐ Pts venta · Total RD$.
- Cuando hay extras: bloque de subtotales con Subtotal base (verde) · Subtotal extras (rojo) · Total general.
- **NO TOCAR** la lógica de PIN ni la estructura de datos.

### WelcomeBanner — Encabezado de bienvenida

- Componente: `components/shared/WelcomeBanner.tsx`
- Presente en los 4 dashboards, justo debajo del `<header>` sticky.
- Muestra: "Hola, {nombre real de Firebase} 👋" + badge de área coloreado + hora actual + fecha en español (es-DO).
- Hora se actualiza cada 60 segundos con `setInterval`. El `useEffect` debe devolver `() => clearInterval(...)` para evitar leak al desmontar.
- Hidratación segura: `ahora = null` en SSR, se inicializa solo en cliente vía `useEffect`.
- Props: `nombre` (string), `area` (string), `acento` (hex del color del badge).

| Dashboard | `area` | `acento` |
|-----------|--------|----------|
| Admin | Hub Admin | #F5C800 |
| Despachador | Despacho | #D42B2B |
| Encargado | Supervisor | #1E8C3A |
| Chofer | Ruta del día | #1A1A1A |

El acento del Chofer es negro intencionalmente (color de header). No es color de la paleta tricolor pero está aceptado como cuarto badge.

### FAB Flotante

- Componente: `components/shared/FloatingFAB.tsx`
- Rojo #D42B2B con pulso, opciones: Imprimir, WhatsApp, PDF, Copiar lista.
- Presente en TODOS los dashboards.
- **NO DUPLICAR** — un solo FAB por pantalla.
- **Impresión**: usa `window.print()` en la página actual (estilos Tailwind intactos). Inyecta `<style id="pb-print-style">` temporal con `@media print` según el modo (factura/tabla/normal); se elimina al cerrar el diálogo (evento `afterprint` + timeout fallback de 8s). El FAB se oculta en impresión vía `.pb-fab-root { display:none }` en `globals.css`.
- **Invariante**: antes de inyectar un nuevo `<style id="pb-print-style">`, hacer `document.getElementById("pb-print-style")?.remove()` para evitar duplicados huérfanos.
- **Excepción**: si hay un modal activo con `getPrintHtml`, abre ventana nueva con HTML propio del modal (comportamiento anterior — solo para modales).
- **Copiar lista**: copia `document.body.innerText` filtrado (texto visible real).
- **WhatsApp**: mensaje incluye título + URL de la página actual.

### Google Sheets

- Sincronización activa con hoja "Polar Breeze Hub".
- Variables configuradas en Vercel: `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`.
- Ver Bug Activo A sobre el estado actual de la clave.

### Endpoint de bootstrap de roles

- Ruta: `POST /api/admin-setup` y `GET /api/admin-setup`.
- Protegido con header `x-setup-token: <SETUP_SECRET>`.
- **GET** → crea/actualiza documento `admin@polarbreeze.com` con `role="admin"` (requiere ADMIN_PASSWORD).
- **POST** → `{"email":"...","role":"admin","nombre":"..."}` actualiza role de cualquier usuario.
- Requiere GOOGLE_PRIVATE_KEY completa y ADMIN_PASSWORD configurada (ver Bug Activo A).
- Ver Deuda D sobre endurecimiento de este endpoint.

**Para activar el acceso admin (una sola vez):**
1. Corregir `GOOGLE_PRIVATE_KEY` en Vercel con la clave RSA completa del service account.
2. Agregar `ADMIN_PASSWORD` en Vercel (contraseña de `admin@polarbreeze.com` en Firebase Auth).
3. Llamar: `curl https://polar-breeze-hub.vercel.app/api/admin-setup -H "x-setup-token: <SETUP_SECRET>"`.
4. Iniciar sesión en el portal con `admin@polarbreeze.com` + ADMIN_PASSWORD.

---

## 🏗️ ARQUITECTURA FIJA — NO CAMBIAR

### Firestore — colecciones reales en producción

| Colección | Contenido | Notas |
|-----------|-----------|-------|
| `usuarios/{uid}` | Cuentas (email, role, nombre, ficha?, activo) | Fuente única de verdad del rol |
| `inventarios/{YYYY-MM-DD}/choferes/{ficha}` | Inventario diario del chofer | Estructura anidada por fecha |
| `lotes_loker/{id}` | Lotes recibidos en el almacén | Buscador del Encargado lee aquí |
| `movimientos_loker/{id}` | Entradas y salidas de stock | Buscador del Encargado lee aquí |
| `alertas/{id}` | Alertas generales del sistema | Unificadas en Hub Admin |
| `weight_alerts/{id}` | Alertas específicas del módulo Weight | Unificadas con alertas en Hub Admin |
| `codigos_cajas/{codigo}` | Catálogo de códigos de barras de cajas | Alimentado por SPIKINSCAN / Weight |
| `talonario/{id}` | Talonario de facturas / despachos | Despachador escribe aquí |
| `history/{id}` | Historial de operaciones del Despachador | Despachador escribe aquí |
| `drivers/{id}` | Datos operativos del chofer (ruta, zona, estado) | Despachador escribe aquí. Cuenta de login vive en `usuarios` |
| `logs/{...}` | Logs de auditoría (auth, operaciones) | Lectura solo admin |

**Aclaraciones importantes:**
- `usuarios` ≠ `drivers`: `usuarios` es la cuenta de login (Firebase Auth + rol). `drivers` guarda datos operativos del chofer (zona, ruta, estado del día). Un chofer tiene un documento en cada una; el vínculo es la `ficha`.
- **Productos del catálogo**: no existe colección `productos` en Firestore — el catálogo (paletas, helados, precios, puntos) vive en código (constantes TypeScript en `lib/` o similar). Si esto cambia, actualizar este archivo.
- **`lotes_loker` vs `movimientos_loker`**: lotes = entrada masiva al almacén (recepción de mercancía); movimientos = transacciones unitarias (entradas/salidas individuales). El stock actual se calcula a partir de movimientos.

### Next.js App Router

```
app/
├── page.tsx                   → Hub Admin "/" (solo admin) + login modo="admin"
├── app-despachador/           → PWA Despachador (guard 3 niveles)
├── app-encargado/             → PWA Encargado   (guard 3 niveles)
├── app-chofer/                → PWA Chofer      (guard 3 niveles)
├── api/                       → Endpoints API
└── globals.css / layout.tsx   → Estilos globales y providers raíz

components/
├── AdminDashboard.tsx
├── DespachadorDashboard.tsx
├── EncargadoDashboard.tsx
├── ChoferDashboard.tsx
├── LoginForm.tsx              → prop modo?: UserRole
├── admin/                     → Módulos del Hub Admin
├── encargado/                 → Módulos del Encargado (incl. BuscadorGlobal)
└── shared/                    → WelcomeBanner, FloatingFAB, RolePill, etc.

lib/
├── auth-context.tsx           → NO TOCAR
├── firebase.ts                → NO TOCAR
└── types.ts                   → NO TOCAR

next.config.ts                 → Redirects /despachador→/app-despachador, etc.
public/
├── polar-breeze-final.html    → App Inventario Choferes (HTML embebida)
└── icon-*.svg                 → Íconos PWA por rol
```

---

## 🎨 IDENTIDAD VISUAL FIJA — NO CAMBIAR

```css
--pb-yellow: #F5C800;  /* Color dominante, acentos, tabs activos */
--pb-red:    #D42B2B;  /* FAB principal, alertas, acento fuerte  */
--pb-green:  #1E8C3A;  /* Confirmaciones, estados OK             */
--pb-white:  #FFFFFF;  /* Fondos primarios                       */
--pb-cream:  #F9F9F7;  /* Fondo de página                        */
--pb-text:   #1A1A1A;  /* Texto principal, header                */
```

- Header: fondo negro `#1A1A1A` con logo 🧊 tricolor.
- Banda tricolor 5px: amarillo · rojo · verde.
- Nombre depto visible: Admin / Despacho / Supervisor / Ruta del día.
- NUNCA usar letras "PB" en el logo.
- NUNCA colores morados — usar siempre paleta Polar Breeze.
- Modo claro siempre en toda la app, **excepto** en `public/polar-breeze-final.html` (la app embebida heredada tiene su propio toggle claro/oscuro).

---

## 🔑 VARIABLES DE ENTORNO (Vercel)

```bash
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
SETUP_SECRET                   # Protege /api/admin-setup
ADMIN_PASSWORD                 # Contraseña de admin@polarbreeze.com
GOOGLE_SHEETS_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY             # ⚠️ Actualmente truncada — ver Bug Activo A
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

---

## 🔧 CONVENCIONES DE CÓDIGO

- Stack: Next.js 14 (App Router), TypeScript estricto, Tailwind CSS, Firebase v10.
- TypeScript estricto — sin `any` sin justificación.
- Tailwind CSS — no CSS inline salvo colores PB.
- `npx tsc --noEmit` debe pasar en 0 errores antes de commit.
- `npm run build` debe pasar limpio antes de push.
- Commits en español con prefijos: `fix:` `feat:` `style:` `docs:` `refactor:`.
- Push directo a `main` (sin PR, sin CI automatizado). Los únicos gates son `tsc` + `build`.
- Una tarea a la vez — verificar en móvil Y desktop antes de commit.
- Zona horaria: `America/Santo_Domingo` (UTC-4, sin DST).
- Moneda: `RD$ 1,234.56` (separador de miles coma, decimal punto).
- Idioma: Español dominicano (`es-DO`).

### Cómo arrancar en local

```bash
npm install
cp .env.example .env.local   # rellenar con las variables de Vercel
npm run dev                  # Turbopack — http://localhost:3000
```

---

## ❌ PENDIENTE — NO EMPEZAR SIN ORDEN EXPLÍCITA

- **Reglas Firestore por rol** (resolver Deuda B antes que cualquier otra cosa de este bloque).
- **Módulo Ajuste Post-Cierre** — para mercancía no reportada descubierta después del cierre del chofer. Inicia Encargado o Despachador, requiere autorización de Oliver, log con fecha/quién/por qué, notifica al chofer por WhatsApp.
- **Ajuste de precios centralizado** — un solo lugar para actualizar precios; refleja en todas las apps.
- **Picking auto-send** — al cerrar picking del Encargado, enviar la lista automáticamente al Despachador como segunda fuente.
- **Asistente Gemini** — asistente conversacional en lenguaje natural dentro de Encargado y Despachador ("¿Quién falta por reportar?"). Distinto del buscador global, que ya está construido.
- Hub Admin histórico + Gemini para Oliver (consultas en lenguaje natural).
- Cierre automático nocturno — Módulo 3.
- PWA instalable por departamento — cada `/app-*` con su `manifest.json` propio e ícono.
- Lanzamiento multiplataforma final (Android/iOS/Windows/Linux como PWA).

---

## 🚫 NUNCA HACER SIN AUTORIZACIÓN EXPLÍCITA

- Cambiar la estructura de Firestore (agregar/quitar/renombrar colecciones).
- Modificar el portal de entrada (`app/page.tsx`).
- Cambiar el sistema de autenticación (`lib/auth-context.tsx`).
- Modificar el bot de Telegram (`app/api/telegram-webhook/route.ts`).
- Borrar o mover archivos en `public/`.
- Cambiar el formato de datos guardados en Firebase.
- Instalar librerías nuevas sin consultar.
- Renombrar archivos clave (como `middleware.ts`).
- Tocar el PIN 1234 de `polar-breeze-final.html` (Deuda C — sin plan de migración no se toca).
- Relajar las reglas Firestore (Deuda B — solo se endurecen, nunca se abren más).

---

## 📅 FLUJO TÍPICO DE UN DÍA

1. **Mañana** — Encargado registra lotes recibidos (escáner HID + báscula).
2. **Despacho** — Despachador prepara salidas y entrega mercancía a cada chofer.
3. **Durante el día** — Chofer consulta su inventario desde la PWA Chofer.
4. **Cierre del chofer** — Chofer envía nota de voz al bot WhatsApp con sobrantes.
5. **Cierre del Encargado** — Encargado confirma inventarios del día en el tab Vista.
6. **Noche (automático)** — sistema genera resúmenes, envía WhatsApp a choferes y Telegram a Oliver, actualiza Hub Admin.

---

## 📖 GLOSARIO

| Término | Definición |
|---------|-----------|
| **Loker** | Almacén principal de Polar Breeze. |
| **Lote** | Entrada masiva de mercancía al Loker (recepción). |
| **Movimiento** | Transacción unitaria (entrada o salida) en el Loker. |
| **Picking** | Proceso del Encargado de preparar mercancía para despacho. |
| **Talonario** | Registro secuencial de facturas / despachos. |
| **Cuarto Frío** | Sección refrigerada del almacén. |
| **Sobrante** | Producto que devuelve el chofer al final del día (C.Tiene). |
| **Quincena** | Período de 15 días para cálculo de puntos del chofer. |
| **Pts venta** | Puntos generados por las ventas del día. |
| **Pts quincena** | Puntos acumulados de la quincena en curso. |
| **Ficha** | Número identificador del chofer (103, 104, …, 120). |
| **HID** | Human Interface Device, modo de escáner USB que se comporta como teclado. |

---

## 📞 DATOS DEL PROYECTO

- **URL:** https://polar-breeze-hub.vercel.app
- **GitHub:** aroelcapellan21-sudo/polar-breeze-hub
- **Firebase:** proyecto `polar-breeze`
- **Bot Telegram:** @polarbreeze_monitor_bot

---

*Proyecto de Ariel Capellán · Asesoría Claude (Anthropic) · Junio 2026*
*Actualizar este archivo cada vez que algo cambie estructuralmente*
