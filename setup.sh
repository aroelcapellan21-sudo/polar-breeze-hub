#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# POLAR BREEZE HUB — Script de restauración del entorno de desarrollo
#
# Uso:
#   bash setup.sh            → instalación normal
#   bash setup.sh --skip-env → omite la creación de .env.local
#   bash setup.sh --ci       → modo CI (sin prompts, falla si falta .env.local)
#
# Requisitos del sistema:
#   - Node.js >= 20
#   - npm   >= 10
#   - git
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✘${RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { echo -e "${CYAN}────────────────────────────────────────${RESET}"; }

# ── Argumentos ───────────────────────────────────────────────────────────────
SKIP_ENV=false
CI_MODE=false
for arg in "$@"; do
  case "$arg" in
    --skip-env) SKIP_ENV=true ;;
    --ci)       CI_MODE=true  ;;
    --help|-h)
      echo "Uso: bash setup.sh [--skip-env] [--ci]"
      exit 0
      ;;
    *) die "Argumento desconocido: $arg. Usá --help para ver las opciones." ;;
  esac
done

# ── Directorio raíz ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   Polar Breeze Hub — Setup del entorno  ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# 1. VERIFICAR PREREQUISITOS
# ══════════════════════════════════════════════════════════════════════════════
hr
info "1/5 · Verificando prerequisitos..."
hr

# Node.js
if ! command -v node &>/dev/null; then
  die "Node.js no encontrado. Instalá la versión 20 LTS desde https://nodejs.org"
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js v${NODE_VER} detectado. Se requiere v20 o superior. Usá nvm: nvm install 20"
fi
ok "Node.js v${NODE_VER}"

# npm
if ! command -v npm &>/dev/null; then
  die "npm no encontrado."
fi
NPM_VER=$(npm --version)
NPM_MAJOR=$(echo "$NPM_VER" | cut -d. -f1)
if [ "$NPM_MAJOR" -lt 10 ]; then
  warn "npm v${NPM_VER} detectado. Se recomienda v10+. Actualizá con: npm install -g npm@latest"
else
  ok "npm v${NPM_VER}"
fi

# git
if ! command -v git &>/dev/null; then
  die "git no encontrado. Instalá con: sudo apt install git"
fi
ok "git $(git --version | awk '{print $3}')"

# ══════════════════════════════════════════════════════════════════════════════
# 2. CLONAR O VERIFICAR REPOSITORIO
# ══════════════════════════════════════════════════════════════════════════════
hr
info "2/5 · Verificando repositorio..."
hr

if [ ! -f "package.json" ]; then
  die "No se encontró package.json. Ejecutá este script desde la raíz del proyecto,\n   o clonalo primero:\n   git clone https://github.com/aroelcapellan21-sudo/polar-breeze-hub.git"
fi

PROJECT_NAME=$(node -e "console.log(require('./package.json').name)" 2>/dev/null || echo "desconocido")
if [ "$PROJECT_NAME" != "polar-breeze-hub" ]; then
  warn "El package.json no corresponde a polar-breeze-hub (encontrado: $PROJECT_NAME)."
fi
ok "Repositorio: ${PROJECT_NAME}"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "desconocida")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "desconocido")
ok "Rama: ${BRANCH} · commit: ${COMMIT}"

# ══════════════════════════════════════════════════════════════════════════════
# 3. VARIABLES DE ENTORNO
# ══════════════════════════════════════════════════════════════════════════════
hr
info "3/5 · Configurando variables de entorno..."
hr

if [ "$SKIP_ENV" = false ]; then
  if [ ! -f ".env.local" ]; then
    if [ ! -f ".env.example" ]; then
      die ".env.example no encontrado. El repositorio puede estar incompleto."
    fi

    if [ "$CI_MODE" = true ]; then
      die ".env.local no encontrado en modo CI. Crealo antes de continuar."
    fi

    cp .env.example .env.local
    echo ""
    warn "Se creó .env.local desde .env.example."
    warn "IMPORTANTE: antes de levantar el servidor debés completar:"
    echo ""
    echo -e "   ${YELLOW}NEXT_PUBLIC_FIREBASE_API_KEY${RESET}  → Firebase Console > Configuración del proyecto"
    echo -e "   ${YELLOW}ANTHROPIC_API_KEY${RESET}             → https://console.anthropic.com/keys"
    echo ""
    warn "El proyecto NO funcionará correctamente sin estos valores."
    echo ""
  else
    ok ".env.local ya existe — no se sobreescribe."

    # Verificar que las variables críticas estén definidas y no sean placeholders
    MISSING=()
    for VAR in \
      NEXT_PUBLIC_FIREBASE_API_KEY \
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
      NEXT_PUBLIC_FIREBASE_PROJECT_ID \
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
      ANTHROPIC_API_KEY; do

      VALUE=$(grep -E "^${VAR}=" .env.local 2>/dev/null | cut -d= -f2- || echo "")
      if [ -z "$VALUE" ] || echo "$VALUE" | grep -qiE "REEMPLAZAR|your_|placeholder|xxx|sk-ant-api"; then
        MISSING+=("$VAR")
      fi
    done

    if [ ${#MISSING[@]} -gt 0 ]; then
      warn "Las siguientes variables en .env.local parecen incompletas:"
      for V in "${MISSING[@]}"; do
        echo -e "   ${YELLOW}→ ${V}${RESET}"
      done
    else
      ok "Variables de entorno verificadas."
    fi
  fi
else
  info "Paso de variables de entorno omitido (--skip-env)."
fi

# ══════════════════════════════════════════════════════════════════════════════
# 4. INSTALAR DEPENDENCIAS
# ══════════════════════════════════════════════════════════════════════════════
hr
info "4/5 · Instalando dependencias (npm ci — versiones exactas del lock)..."
hr

if [ ! -f "package-lock.json" ]; then
  warn "package-lock.json no encontrado. Usando npm install en lugar de npm ci."
  npm install
else
  npm ci
fi

ok "Dependencias instaladas."

# Mostrar versiones clave
echo ""
info "Versiones de dependencias principales:"
node -e "
const pkg = require('./package.json');
const deps = {...pkg.dependencies, ...pkg.devDependencies};
['next','react','typescript','tailwindcss','firebase','@anthropic-ai/sdk'].forEach(d => {
  if(deps[d]) console.log('   ' + d.padEnd(25) + deps[d]);
});
"

# ══════════════════════════════════════════════════════════════════════════════
# 5. VERIFICACIÓN RÁPIDA DEL PROYECTO
# ══════════════════════════════════════════════════════════════════════════════
hr
info "5/5 · Verificando compilación TypeScript..."
hr

if npx tsc --noEmit --skipLibCheck 2>&1 | tee /tmp/polar_tsc.log; then
  ok "TypeScript compila sin errores."
else
  TSC_ERRORS=$(wc -l < /tmp/polar_tsc.log)
  warn "TypeScript reportó ${TSC_ERRORS} líneas de error. Revisá /tmp/polar_tsc.log"
  warn "El entorno está instalado pero puede haber problemas de tipos."
fi

# ══════════════════════════════════════════════════════════════════════════════
# RESUMEN FINAL
# ══════════════════════════════════════════════════════════════════════════════
echo ""
hr
echo -e "${BOLD}${GREEN}  ✅  Entorno listo${RESET}"
hr
echo ""
echo -e "  ${BOLD}Comandos disponibles:${RESET}"
echo ""
echo -e "   ${CYAN}npm run dev${RESET}    → Servidor de desarrollo en http://localhost:3000"
echo -e "   ${CYAN}npm run build${RESET}  → Build de producción"
echo -e "   ${CYAN}npm run start${RESET}  → Servidor de producción (requiere build previo)"
echo -e "   ${CYAN}npm run lint${RESET}   → Análisis de código con ESLint"
echo ""
echo -e "  ${BOLD}Scripts de seed (datos iniciales):${RESET}"
echo ""
echo -e "   ${CYAN}node scripts/seed-users.mjs${RESET}          → Usuarios base (Admin, Despachador, Chofer)"
echo -e "   ${CYAN}node scripts/seed-catalogo.mjs${RESET}       → Catálogo de productos"
echo -e "   ${CYAN}node scripts/seed-inventario-base.mjs${RESET} → Stock inicial del cuarto frío"
echo -e "   ${CYAN}node scripts/seed-precios.mjs${RESET}        → Precios de productos"
echo ""
echo -e "  ${BOLD}Secretos necesarios en GitHub (para CI/CD):${RESET}"
echo ""
echo -e "   ${YELLOW}VERCEL_TOKEN${RESET}       → https://vercel.com/account/tokens"
echo -e "   ${YELLOW}VERCEL_ORG_ID${RESET}      → Configuración de tu equipo en Vercel"
echo -e "   ${YELLOW}VERCEL_PROJECT_ID${RESET}  → Configuración del proyecto en Vercel"
echo -e "   ${YELLOW}TELEGRAM_BOT_TOKEN${RESET} → BotFather en Telegram (notificaciones de build)"
echo ""
echo -e "  ${BOLD}Configurarlos en:${RESET}"
echo -e "   https://github.com/aroelcapellan21-sudo/polar-breeze-hub/settings/secrets/actions"
echo ""
hr
echo ""
