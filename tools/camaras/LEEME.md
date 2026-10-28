# Cámaras de caletas en la plataforma

Las cámaras Dahua están en la red interna de la caleta (direcciones 10.1.1.x), por lo que la plataforma
no puede verlas directamente. Un equipo pequeño encendido en esa misma red las lee y las publica por un
túnel cifrado de salida. No se abren puertos en el router y las cámaras nunca quedan expuestas a internet.

```
Cámaras (10.1.1.65 / .66) ──RTSP──▶ equipo local (go2rtc) ──túnel──▶ Cloudflare ──▶ plataforma (Vercel) ──▶ usuarios con permiso
```

## 1. En cada grabador Dahua (desde DMSS o la web del equipo)
1. Crear un usuario **de solo visualización** (por ejemplo `plataforma`). No usar `admin`.
2. Confirmar que RTSP está activo (Configuración → Red → Puertos; normalmente puerto 554).
3. Si `admin` tiene la contraseña de fábrica, cambiarla.

## 2. Equipo local (instalación automática)
Un mini PC o Raspberry Pi 4/5 con Linux (Raspberry Pi OS, Debian o Ubuntu), conectado por cable a la misma
red de las cámaras y encendido siempre. Debe autorizarlo quien administre esa red.

1. Copiar `instalar-camaras.sh` al equipo.
2. Ejecutar `sudo bash instalar-camaras.sh` y responder las preguntas (IP, puerto, canales, usuario y clave
   de visualización de cada equipo Dahua, y el token del túnel).
3. El instalador instala Docker, configura todo, prueba cada cámara y al final muestra
   **Dirección, Usuario y Clave** para la plataforma, y la lista de transmisiones (`cam1`, `cam2`, …).

Los archivos `go2rtc.yaml`, `docker-compose.yml` y `.env.ejemplo` de esta carpeta son la configuración
equivalente para quien prefiera hacerlo a mano.

## 3. Túnel (Cloudflare, plan gratuito)
Requiere un dominio administrado en Cloudflare.
1. Cloudflare Zero Trust → Networks → Tunnels → Create tunnel (tipo Cloudflared). Copiar el token (el texto
   después de `--token`) y pegarlo cuando el instalador lo pida.
2. En «Public hostname» crear, por ejemplo, `camaras.su-dominio.cl` → Service HTTP → URL `go2rtc:1984`.
3. Recomendado: proteger ese nombre con Cloudflare Access usando un **Service Token** (política «Service Auth»).

## 4. En la plataforma
1. Administrador: pestaña **Cámaras**. En «Conexión con el equipo local» escribir la Dirección, el Usuario y la
   Clave que mostró el instalador (y, si usas Access, el Client ID y Client Secret). Pulsar **Guardar conexión**:
   la plataforma prueba la conexión y lista las transmisiones.
2. **Configurar cámaras → + Agregar cámara**: nombre, caleta y transmisión (`cam1`, `cam2`, …). Guardar.
3. En **Administración → Usuarios**, marcar «Ver cámaras» a quienes corresponda. Cada usuario ve solo las
   cámaras de sus caletas, zonas o comunas (misma regla que los datos).

Alternativa: definir la conexión con las variables de Vercel `CAM_RELAY_URL`, `CAM_RELAY_USER`,
`CAM_RELAY_PASS` (y `CAM_CF_ID`, `CAM_CF_SECRET`); si existen, tienen prioridad.

## Resguardos
- Las imágenes no se almacenan en la plataforma; cada vista en vivo queda en la bitácora.
- El video en vivo se detiene solo a los 10 minutos y al cambiar de sección o de pestaña del navegador.
- Mantener la señalética de videovigilancia y limitar el acceso a quienes lo necesitan (protección de datos personales).
