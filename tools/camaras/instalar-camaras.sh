#!/usr/bin/env bash
# Instalador del equipo local de cámaras · Plataforma de Gestión Borde Costero · AAPP Norte
# Uso (en el equipo local, conectado a la red de las cámaras):   sudo bash instalar-camaras.sh
# Instala Docker si falta, configura go2rtc (lee las cámaras Dahua por RTSP) y, si se entrega un token,
# el túnel de Cloudflare. Las claves quedan solo en /opt/camaras/.env (permisos 600) en este equipo.
set -euo pipefail
DIR="${CAM_DIR:-/opt/camaras}"
DRY="${DRYRUN:-0}"   # DRYRUN=1 genera los archivos sin instalar ni iniciar nada (para revisión)

IN=/dev/stdin; if [[ "$DRY" != 1 ]] && { : </dev/tty; } 2>/dev/null; then IN=/dev/tty; fi
azul(){ printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
mal(){ printf '  \033[31m✗\033[0m %s\n' "$*"; }
preg(){ local p="$1" d="${2:-}" r; read -r -p "  $p${d:+ [$d]}: " r <"$IN" || true; printf '%s' "${r:-$d}"; }
clave(){ local p="$1" r; read -r -s -p "  $p: " r <"$IN" || true; echo >&2; printf '%s' "$r"; }
urlenc(){ local s="$1" o="" c i; for ((i=0;i<${#s};i++)); do c="${s:i:1}"; case "$c" in [a-zA-Z0-9.~_-]) o+="$c";; *) o+=$(printf '%%%02X' "'$c");; esac; done; printf '%s' "$o"; }
aleatorio(){ head -c 800 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-"${1:-24}"; }

if [[ "$DRY" != 1 && $EUID -ne 0 ]]; then echo "Ejecuta con sudo:  sudo bash $0"; exit 1; fi

azul "1/5 · Docker"
if [[ "$DRY" == 1 ]]; then ok "modo revisión: no se instala nada"
elif command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then ok "Docker ya está instalado"
else
  echo "  Instalando Docker (puede tardar unos minutos)…"
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker instalado"
fi

azul "2/5 · Cámaras"
echo "  Usa el usuario de SOLO VISUALIZACIÓN creado en cada grabador (no admin)."
echo "  Si un equipo es un grabador con varias cámaras, indica sus canales separados por coma (ej.: 1,2,3,4)."
N=$(preg "¿Cuántos equipos Dahua (cámaras o grabadores)?" "2")
DEF_IPS=(10.1.1.65 10.1.1.66)
STREAMS=""; ENVCAM=""; RESUMEN=(); k=0
for ((e=1;e<=N;e++)); do
  echo; echo "  — Equipo $e —"
  ip=$(preg "Dirección IP" "${DEF_IPS[$((e-1))]:-}")
  pr=$(preg "Puerto RTSP" "554")
  ch=$(preg "Canales" "1")
  us=$(preg "Usuario de visualización" "plataforma")
  pw=$(clave "Clave de ese usuario (no se muestra)")
  if timeout 3 bash -c "</dev/tcp/$ip/$pr" 2>/dev/null; then ok "$ip:$pr responde"; else mal "$ip:$pr no responde (revisa IP, puerto o que RTSP esté activo). Se configura igual."; fi
  ENVCAM+="CAM_USER_$e=$(urlenc "$us")"$'\n'"CAM_PASS_$e=$(urlenc "$pw")"$'\n'
  IFS=',' read -r -a chs <<<"$ch"
  for c in "${chs[@]}"; do c="${c// /}"; [[ -z "$c" ]] && continue; k=$((k+1))
    STREAMS+="  cam$k: rtsp://\${CAM_USER_$e}:\${CAM_PASS_$e}@$ip:$pr/cam/realmonitor?channel=$c&subtype=1"$'\n'
    RESUMEN+=("cam$k  →  $ip canal $c")
  done
done

azul "3/5 · Túnel seguro (Cloudflare)"
echo "  Pega el token del túnel (Cloudflare Zero Trust → Networks → Tunnels → tu túnel)."
echo "  Si aún no lo tienes, deja vacío: puedes volver a ejecutar este instalador después."
TOKEN=$(clave "Token del túnel")
HOST=$(preg "Dirección pública configurada en el túnel (ej.: camaras.su-dominio.cl)" "")

azul "4/5 · Archivos de configuración en $DIR"
mkdir -p "$DIR"
RU="plataforma"; RP=""
[[ -f "$DIR/.env" ]] && RP=$(grep -E '^RELAY_PASS=' "$DIR/.env" | cut -d= -f2- || true)
[[ -z "$RP" ]] && RP=$(aleatorio 28)
umask 077
{ printf '# Generado por instalar-camaras.sh — contiene claves: no compartir ni subir a ningún repositorio.\n'
  printf '%s' "$ENVCAM"; printf 'RELAY_USER=%s\nRELAY_PASS=%s\nTUNNEL_TOKEN=%s\n' "$RU" "$RP" "$TOKEN"; } >"$DIR/.env"
chmod 600 "$DIR/.env"
umask 022
cat >"$DIR/go2rtc.yaml" <<EOF
# Generado por instalar-camaras.sh. Las claves se leen de .env.
api:
  listen: ":1984"
  username: \${RELAY_USER}
  password: \${RELAY_PASS}
rtsp:
  listen: ""
webrtc:
  listen: ""
streams:
$STREAMS
EOF
{ cat <<'EOF'
services:
  go2rtc:
    image: alexxit/go2rtc:latest
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./go2rtc.yaml:/config/go2rtc.yaml:ro
    ports:
      - "127.0.0.1:1984:1984"
EOF
  if [[ -n "$TOKEN" ]]; then cat <<'EOF'
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    env_file: .env
    depends_on: [go2rtc]
EOF
  fi; } >"$DIR/docker-compose.yml"
ok "Configuración escrita (claves en $DIR/.env, permisos 600)"

azul "5/5 · Inicio y prueba"
if [[ "$DRY" == 1 ]]; then ok "modo revisión: no se inicia nada"; else
  (cd "$DIR" && docker compose pull -q && docker compose up -d --remove-orphans) >/dev/null
  ok "Servicios iniciados (se reinician solos si el equipo se apaga)"
  sleep 6
  for ((i=1;i<=k;i++)); do
    sz=$(curl -s -u "$RU:$RP" -m 20 -o /tmp/cam$i.jpg -w '%{size_download}' "http://127.0.0.1:1984/api/frame.jpeg?src=cam$i" || echo 0)
    if [[ "${sz:-0}" -gt 1000 ]]; then ok "cam$i entrega imagen"; else mal "cam$i sin imagen (revisa usuario, clave, puerto o canal)"; fi
    rm -f /tmp/cam$i.jpg
  done
  if [[ -n "$TOKEN" ]]; then sleep 4; if docker compose -f "$DIR/docker-compose.yml" logs cloudflared 2>&1 | grep -qi "Registered tunnel connection"; then ok "Túnel conectado"; else mal "El túnel aún no confirma conexión: revisa el token o espera un minuto"; fi; fi
fi

azul "LISTO · Datos para la plataforma (Cámaras → Configurar cámaras → Conexión)"
if [[ -n "$HOST" ]]; then echo "  Dirección : https://${HOST#https://}"; else echo "  Dirección : (la dirección pública del túnel, con https://)"; fi
echo "  Usuario   : $RU"
echo "  Clave     : $RP"
echo
echo "  Transmisiones para agregar cada cámara:"
for r in "${RESUMEN[@]}"; do echo "    $r"; done
echo
echo "  Guarda la clave en un lugar seguro y limpia la pantalla después (comando: clear)."
echo "  Para cambiar algo, vuelve a ejecutar:  sudo bash $0   (la clave de la plataforma se mantiene)."
