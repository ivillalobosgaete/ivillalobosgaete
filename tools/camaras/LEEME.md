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

## 2. Equipo local
Un mini PC o Raspberry Pi 4/5 con Linux y Docker, conectado por cable a la misma red de las cámaras y
encendido siempre. Debe autorizarlo quien administre esa red.

1. Copiar esta carpeta al equipo.
2. Copiar `.env.ejemplo` como `.env` y completar los valores.
3. Ajustar en `go2rtc.yaml` las direcciones y el canal si corresponde.
4. Ejecutar `docker compose up -d`.
5. Probar en el mismo equipo: abrir `http://127.0.0.1:1984` y verificar que `cam1` y `cam2` muestran imagen.

## 3. Túnel (Cloudflare, plan gratuito)
Requiere un dominio administrado en Cloudflare.
1. Cloudflare Zero Trust → Networks → Tunnels → Create tunnel (tipo Cloudflared). Copiar el token en `TUNNEL_TOKEN`.
2. En «Public hostname» crear, por ejemplo, `camaras.su-dominio.cl` apuntando a `http://go2rtc:1984`.
3. Recomendado: proteger ese nombre con Cloudflare Access usando un **Service Token**, para que solo la
   plataforma pueda llegar al equipo.

## 4. Vercel (Settings → Environment Variables)
| Variable | Valor |
|---|---|
| `CAM_RELAY_URL` | `https://camaras.su-dominio.cl` |
| `CAM_RELAY_USER` / `CAM_RELAY_PASS` | los mismos `RELAY_USER` / `RELAY_PASS` del `.env` |
| `CAM_CF_ID` / `CAM_CF_SECRET` | (opcional) Client ID y Client Secret del Service Token de Access |

Volver a publicar el proyecto.

## 5. En la plataforma
1. Administrador: pestaña **Cámaras → Configurar cámaras**. Agregar cada cámara con su nombre, caleta y
   nombre de transmisión (`cam1`, `cam2`).
2. En **Administración → Usuarios**, marcar «Ver cámaras» a quienes corresponda. Cada usuario ve solo las
   cámaras de sus caletas, zonas o comunas (misma regla que los datos).

## Resguardos
- Las imágenes no se almacenan en la plataforma; cada vista en vivo queda en la bitácora.
- El video en vivo se detiene solo a los 10 minutos y al cambiar de sección o de pestaña del navegador.
- Mantener la señalética de videovigilancia y limitar el acceso a quienes lo necesitan (protección de datos personales).
