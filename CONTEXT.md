# CONTEXT.md — Polar Breeze Hub
# Lee esto ANTES de tocar cualquier archivo
# Actualizado: 30 Mayo 2026

---

## 🚨 REGLA #1 — LA MÁS IMPORTANTE
**Antes de cambiar algo, verifica que funciona.**
**Después de cambiarlo, verifica que sigue funcionando.**
**Si rompes algo al arreglarlo — PARA y revierte antes de continuar.**
**Verificar SIEMPRE en móvil Y desktop antes de hacer commit.**

---

## 📋 QUÉ HACE ESTA APP

Sistema de gestión operativa para Polar Breeze, S.R.L. — distribuidora de helados BON en Santiago, Rep. Dom.

Tres roles operativos:
- **Admin** → Oliver (dueño) — control total
- **Despacho** → Despachador — salida de mercancía y choferes
- **Supervisor** → Encargado — inventarios, lotes, stock

---

## ✅ CONSTRUIDO Y FUNCIONANDO — NO TOCAR SIN AUTORIZACIÓN

### Portal de entrada
- Login con email/contraseña + Firebase Auth
- Redirección automática por rol
- **NO TOCAR**: `app/page.tsx`, `lib/auth-context.tsx`

### App Despachador
- 6 tabs: Cuarto Frío, Choferes, Comparar, Historial, Cierre, Anomalías
- Guarda en: `history`, `talonario`, `drivers`, `movimientos_loker`
- Tablas de referencia con puntos y precios
- SPIKINSCAN con escáner HID
- **NO TOCAR SIN AUTORIZACIÓN**: `components/DespachadorDashboard.tsx`

### App Encargado / Supervisor
- Registro de lotes con escáner HID y buscador inteligente de productos
- Tab Choferes → cierre del día, puntos quincena, inventario despachado
- Tab Stock → barras de progreso con semáforo de colores
- Tab Weight → escáner HID + báscula Bluetooth
- **NO TOCAR SIN AUTORIZACIÓN**: `components/EncargadoDashboard.tsx`

### Hub Admin
- KPIs en tiempo real desde Firebase
- Gráfico de ventas 7 días (SVG puro)
- Ranking TOP 5 choferes
- Gráfico dona distribución de productos
- Alertas unificadas en tiempo real
- Tablero de rutas activas por zona
- Módulo gestión de usuarios (crear, editar, desactivar)
- **NO TOCAR SIN AUTORIZACIÓN**: `components/AdminDashboard.tsx`

### Bot Telegram
- Activo en @polarbreeze_monitor_bot
- Comandos: /estado, /alertas, /choferes, /resumen_hoy
- **NO TOCAR**: `app/api/telegram-webhook/route.ts`

### App Inventario Choferes
- Archivo: `public/polar-breeze-final.html`
- Vive dentro del tab Vista del Dashboard del Encargado
- PIN 1234, barra de progreso tricolor, chips de choferes con 3 estados
- Modo claro/oscuro funcionando
- Badge ⚠ aparece al escribir en producto fuera del inventario base
- Productos extras (en rojo) SÍ suman en los totales
- Modal confirmación muestra pts venta + pts quincena
- El encargado ingresa **sobrante** (C.Tiene); C.Vendida = base − sobrante
- Modal de inventario registrado se muestra centrado en desktop (max-width 580px)
- Productos extras aparecen en sección "⚠ Extras" dentro del detalle de inventario guardado
- Detalle de inventario guardado muestra Total RD$ por producto (base y extras) + Total General al pie
- **NO TOCAR** la lógica de PIN ni la estructura de datos

### FAB Flotante
- Componente: `components/FloatingFAB.tsx`
- Rojo #D42B2B con pulso, opciones: Imprimir, WhatsApp, PDF
- Presente en TODOS los dashboards
- **NO DUPLICAR** — un solo FAB por pantalla

### Google Sheets
- Sincronización activa con hoja "Polar Breeze Hub"
- Variables configuradas en Vercel: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY

---

## 🔴 BUGS CONOCIDOS AHORA MISMO

Sin bugs activos. Todos los bugs anteriores fueron corregidos el 30 Mayo 2026:

| # | Bug | Commit | Estado |
|---|-----|--------|--------|
| 1 | Botón Salir no aparecía en móvil en Hub Admin | `06b3da5` | ✅ Corregido |
| 2 | Ver inventario de choferes no funcionaba en desktop | `90d2b39` | ✅ Corregido |
| 3 | C.Tiene y C.Vendida invertidos en app inventario | `90d2b39` | ✅ Corregido |
| 4 | Deploy Vercel fallando por `middleware.ts` renombrado | `9845f1e` | ✅ Corregido |
| 5 | Productos extras no aparecían en detalle de inventario guardado | `2e29efd` | ✅ Corregido |

---

## 🏗️ ARQUITECTURA FIJA — NO CAMBIAR

```
Firebase Firestore (base de datos)
├── usuarios/{uid}
├── inventarios/{fecha}/choferes/{ficha}
├── lotes_loker/{id}
├── movimientos_loker/{id}
├── alertas/{id}
├── codigos_cajas/{codigo}
├── weight_alerts/{id}
└── talonario/{id}

Next.js App Router
├── app/page.tsx          → Portal entrada (NO TOCAR)
├── app/api/              → Endpoints API
├── components/           → Dashboards por rol
├── components/admin/     → Módulos del Hub Admin
├── components/encargado/ → Módulos del Encargado
├── components/shared/    → Componentes compartidos
├── lib/                  → Firebase, auth, types
└── public/               → polar-breeze-final.html
```

---

## 🎨 IDENTIDAD VISUAL FIJA — NO CAMBIAR

```
Amarillo:  #F5C800  — dominante, tabs activos, barras progreso
Rojo:      #D42B2B  — FAB, alertas, acciones críticas
Verde:     #1E8C3A  — confirmaciones, estado OK
Fondo:     #F9F9F7  — siempre modo claro
Texto:     #1A1A1A
Tipografía: Nunito (Google Fonts)
```

- Header: fondo negro #1A1A1A con logo 🧊 tricolor
- Banda tricolor 5px: amarillo | rojo | verde
- Nombre depto: Admin / Despacho / Supervisor
- NUNCA usar letras "PB" en el logo
- NUNCA colores morados — usar siempre paleta Polar Breeze

---

## 🔧 CONVENCIONES DE CÓDIGO

- TypeScript estricto — sin `any` sin justificación
- Tailwind CSS — no CSS inline salvo colores PB
- `npx tsc --noEmit` debe pasar en 0 errores antes de commit
- `npm run build` debe pasar limpio antes de push
- Commits en español con prefijos: `fix:` `feat:` `style:` `docs:`
- Push directo a `main`
- Una tarea a la vez — verificar en móvil Y desktop antes de commit

---

## ❌ PENDIENTE — NO EMPEZAR SIN ORDEN EXPLÍCITA

- Buscador inteligente en Dashboard Encargado
- Módulo Ajuste Post-Cierre
- Reglas de seguridad Firestore por rol
- Ajuste de precios centralizado
- Bot WhatsApp para choferes
- Asistente Gemini para Encargado y Despachador
- Cierre automático nocturno
- Módulo histórico y consultas para Oliver con Gemini
- PWA instalable por departamento
- Acceso remoto a la Dell
- Lanzamiento multiplataforma final

---

## 🚫 NUNCA HACER SIN AUTORIZACIÓN EXPLÍCITA

- Cambiar la estructura de Firestore
- Modificar el portal de entrada (page.tsx)
- Cambiar el sistema de autenticación
- Modificar el bot de Telegram
- Borrar o mover archivos en public/
- Cambiar el formato de datos guardados en Firebase
- Instalar librerías nuevas sin consultar
- Renombrar archivos clave (como middleware.ts)

---

## 📞 DATOS DEL PROYECTO

- URL: polar-breeze-hub.vercel.app
- GitHub: aroelcapellan21-sudo/polar-breeze-hub
- Firebase: proyecto polar-breeze
- Zona horaria: America/Santo_Domingo (UTC-4)
- Moneda: RD$ formato RD$1,234.56
- Idioma: Español dominicano

---

*Proyecto de Ariel Capellán · Asesoría Claude (Anthropic) · Mayo 2026*
*Actualizar este archivo cada vez que algo cambie estructuralmente*
