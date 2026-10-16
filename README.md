# Estadísticas de Recolección y Captura · Asuntos Públicos

Plataforma web para revisar el desembarque artesanal y la recolección de orilla de pescadores:
- Asuntos Públicos Norte: Antofagasta y Mejillones.
- Asuntos Públicos Los Pelambres: Los Vilos y Canela.

Funciones principales:
- Inicio de sesión con usuario y contraseña, y creación de cuentas que un administrador aprueba.
- Dos niveles de usuario: Administrador y Visualizador.
- Dashboard con filtros y con un selector para ver toneladas totales o promedios.
- Calculadora de negociación.
- Mapa de poder e interés (5×5) por zona, por pescador u organización, con ranking y bitácora de relacionamiento.
- Alertas automáticas, comparación de zonas, proyección de 3 meses y reporte ejecutivo imprimible.
- Valor económico con precios de playa, calendario de vedas, escenarios de compensación, vistas guardadas y registro de actividad.
- Carga de Excel para actualizar los datos.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La plataforma completa (pantallas, gráficos, filtros, lectura del Excel). |
| `api/` | Funciones del servidor: inicio de sesión, usuarios, datos e historial de cargas. |
| `lib/core.js` | Código compartido por las funciones: contraseñas, sesión y acceso a la base. |
| `supabase/schema.sql` | Crea las tablas de la base de datos. |
| `vercel.json` | Configuración y cabeceras de seguridad para Vercel. |
| `server.js` | Servidor para hostings con Node distintos de Vercel (Render, Railway, VPS). |
| `tools/hash.js` | Genera el hash de una contraseña para restablecerla a mano. |
| `.env.example` | Lista de variables de configuración. |

La seguridad se aplica en el servidor:
- Las contraseñas se guardan cifradas con scrypt, nunca en texto.
- La sesión vive en una cookie firmada a la que el navegador no tiene acceso.
- Un Visualizador no puede modificar datos ni administrar usuarios, aunque intente llamar directamente a la API.
- Las restricciones por comuna y la opción de ocultar nombres se aplican antes de enviar los datos al navegador.

## Publicar en Vercel (unos 15 minutos)

### 1. Crear la base de datos en Supabase (gratis)
1. Entra a https://supabase.com y crea un proyecto. Elige la región São Paulo, que es la más cercana a Chile.
2. Abre **SQL Editor > New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**.
3. Ve a **Project Settings > API** y copia:
   - **Project URL**, que irá en `SUPABASE_URL`.
   - La clave **service_role**, que irá en `SUPABASE_SERVICE_ROLE_KEY`. Es secreta: nunca la pongas en `index.html` ni la compartas.

### 2. Subir el código a GitHub
Crea un repositorio **privado** y sube esta carpeta completa. No subas archivos `.env` ni el Excel; el `.gitignore` ya los excluye.

### 3. Crear el proyecto en Vercel
1. En https://vercel.com elige **Add New > Project** e importa el repositorio.
2. En **Framework Preset** elige **Other**. No hace falta comando de compilación.
3. En **Environment Variables** agrega:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | La Project URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | La clave service_role |
| `SESSION_SECRET` | Un texto largo y aleatorio (ver abajo) |
| `ADMIN_USER` | `ivillalobos` |
| `ADMIN_PASSWORD` | La contraseña del administrador |

Para generar `SESSION_SECRET`, en una terminal con Node escribe:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

4. Presiona **Deploy**.

### 4. Primer ingreso
1. Abre la dirección que te da Vercel e inicia sesión con `ADMIN_USER` y `ADMIN_PASSWORD`. El administrador se crea solo en ese momento.
2. Como aún no hay datos, la plataforma te pedirá subir el Excel. Usa el archivo con la hoja **DatosPesca**.
3. Listo. Desde ahí:
   - Los demás crean su cuenta con **Crear cuenta**.
   - Tú las apruebas en la pestaña **Administración**.

Después del primer ingreso puedes borrar `ADMIN_PASSWORD` de Vercel: el administrador ya quedó guardado. Si la dejas y alguien elimina la cuenta `ADMIN_USER`, se volverá a crear con esa contraseña en el siguiente inicio de sesión.

## Indicadores económicos y actividad por caleta
- **Indicadores del día:** dólar observado, euro, UF, UTM, cobre, IPC y tasa de política monetaria. Se obtienen automáticamente desde mindicador.cl, que publica los valores del Banco Central de Chile, y se actualizan cada 30 minutos.
- **Actividad por caleta y mes:** un mapa de calor con las caletas agrupadas por zona (Asuntos Públicos Norte y Asuntos Públicos Los Pelambres) y los 12 meses. Responde a los filtros y al selector de medida (toneladas totales, promedio mensual o promedio por pescador).

## Mapa de poder e interés
- Hay un mapa de 5×5 y un ranking por toneladas para cada zona: Asuntos Públicos Norte y Asuntos Públicos Los Pelambres.
- **Poder de influencia (1 a 5):** se calcula por volumen. Los pescadores se ordenan por toneladas dentro de su zona y se dividen en quintiles; el 20 % con más toneladas queda en 5.
- **Interés (1 a 5):** se calcula por regularidad, es decir, por los meses con desembarque en el período. También se divide en quintiles.
- **Estrategia sugerida:**
  - Gestionar de cerca: poder 3 o más e interés 3 o más.
  - Mantener satisfecho: poder 3 o más, interés bajo 3.
  - Mantener informado: poder bajo 3, interés 3 o más.
  - Monitorear: el resto.
- Un administrador puede ajustar el poder y el interés de cada pescador con **Evaluar** y dejar una nota. La nota solo la ven los administradores. También puede volver al cálculo automático.
- Los ajustes se guardan en la tabla `evaluaciones`.
- **Si ya tenías la plataforma publicada:** vuelve a ejecutar `supabase/schema.sql` en Supabase. Es seguro repetirlo: solo crea la tabla nueva. Mientras no lo hagas, el mapa funciona igual, pero solo con el cálculo automático.

## Funciones de gestión
- **Reporte ejecutivo** (botón en el encabezado): resumen de una página con indicadores, comparación de zonas, alertas, claves, proyección y actores clave. Se puede imprimir o guardar como PDF, o descargar como HTML.
- **Alertas** (Resumen): caídas de una caleta, especie o zona frente al mismo mes del año anterior, y pescadores de "Gestionar de cerca" sin desembarques en los últimos 3 meses. Si la especie estaba en veda, la alerta lo indica. El umbral se ajusta en Administración.
- **Comparación de zonas** y **Proyección de los próximos 3 meses** (Resumen). La proyección es el promedio del mismo mes en los últimos 3 años, ajustado por la tendencia de 12 meses.
- **Valor económico:** un administrador ingresa precios de playa ($ por kg) en Administración. Con eso aparecen el valor estimado, el poder según valor y los montos en la negociación.
- **Organizaciones:** el mapa de poder e interés puede agrupar por organización. Se usa la columna Organización del Excel, o la que asigne un administrador con **Evaluar**.
- **Bitácora:** reuniones, compromisos, acuerdos y conflictos por pescador u organización, con estado y responsable. Solo la ven los administradores. Los pendientes aparecen en "Compromisos y seguimiento".
- **Escenarios de compensación** (Negociación): compara costo total y reparto de A (por kilo histórico), B (monto fijo) y C (mixto).
- **Revisión de calidad al cargar el Excel:** avisa RPA sin nombre, fechas futuras, filas repetidas, nombres distintos para un mismo RPA, especies y caletas nuevas (y las parecidas a una existente) y volúmenes inusuales. No impide la carga.
- **Vedas:** se registran en Administración. Se ven en el calendario de vedas (Especies y caletas) y sombreadas en la evolución mensual cuando filtras esa especie.
- **Vistas guardadas:** cada usuario guarda combinaciones de filtros y las abre con un clic.
- **Registro de actividad** (Administración): inicios de sesión, cargas, cambios de usuarios, evaluaciones, bitácora, ajustes, reportes y exportaciones.

**Si actualizas una plataforma ya publicada:** vuelve a ejecutar `supabase/schema.sql` en Supabase. Crea las tablas nuevas (`ajustes`, `bitacora`, `vistas`, `actividad`) y agrega la columna `organizacion` a `evaluaciones`, sin tocar los datos existentes.

## Exigencias ambientales (RCA)
Pestaña para revisar las resoluciones de calificación ambiental (RCA) de las operaciones y ordenar sus obligaciones.
- **Carga inicial (una vez, solo administradores):** en la pestaña **Exigencias ambientales**, presiona **Cargar base de RCA** y elige `RCA_Operaciones_Norte_base.json.gz`. Ese archivo trae las RCA divididas en fichas por numeral o considerando. Si más adelante cargas una base nueva, las categorizaciones se conservan.
- **Medio humano y comunidades:** la base trae el tema «Medio humano, comunidades y pescadores» con seis subtemas (pescadores y caletas, pueblos indígenas, organizaciones sociales y vecinos, participación ciudadana, grupos humanos y calidad de vida, proveedores y empleo local) y el filtro **Tipo de texto** (obligación, observación ciudadana, evaluación de impactos, descripción, vistos). El botón **Compromisos con comunidades** combina ambos. Para activarlo, vuelve a cargar `RCA_Operaciones_Norte_base.json.gz`; las categorizaciones existentes se conservan.
- **Seguimiento de cumplimiento:** cada ficha categorizada muestra sus verificadores o indicadores de cumplimiento (extraídos del texto de la RCA; el administrador puede editarlos, quitarlos o agregar otros). El administrador asigna un porcentaje de avance y una observación a cada verificador y presiona **Guardar avance**; cada cambio queda en el historial con fecha y usuario. La vista **Seguimiento** lista todos los compromisos con su avance promedio y se exporta a CSV. Los usuarios ven el avance de los compromisos habilitados, sin las observaciones. Requiere las tablas `rca_seguimiento` y `rca_seguimiento_hist` (vuelve a ejecutar `supabase/schema.sql`).
- **Un registro por considerando:** cada considerando numerado (o subnumeral del considerando, como 12.1.26) es un solo registro con todo su texto, aunque ocupe varias páginas; se indica la página de inicio y término. Los números de página, fechas, cantidades y listas internas no abren registros. Los saltos o repeticiones de numeración quedan marcados como **Duda de numeración** (vista "Con dudas de numeración"). Al cargar la base nueva, las categorías y el avance registrados en bases anteriores pasan al considerando correspondiente.
- **Detalle de cada RCA:** N° RCA, áreas de influencia (localidades que menciona la RCA), objetivo y alcance. La vista **Montos de inversión** muestra un gráfico interactivo por RCA y compañía (escala lineal o logarítmica; clic en una barra abre la RCA).
- **Confirmación:** catalogar, descartar, restaurar, cambiar la visibilidad o eliminar algo pide confirmación con botones Sí / No.
- **Encabezado:** muestra el lugar aproximado de conexión (en Vercel, según la IP; endpoint `api/lugar`) y la fecha y hora actuales.
- **Buscar y filtrar:** por palabras clave (sin importar tildes ni mayúsculas; usa comillas para una frase exacta y `-palabra` para excluir), compañía, RCA, tipo (DIA o EIA), tema (pesca, comunidades, agua, fauna, patrimonio…), categoría y estado de revisión.
- **Categorizar (solo administradores):** cada ficha puede quedar como Compromiso ambiental voluntario; Medida (mitigación, reparación o compensación); Plan de seguimiento o vigilancia; Exigencia o condición; Otro; o Descartado. La plataforma muestra una categoría sugerida según la sección de la RCA, pero no la asigna sola. También puedes categorizar varias fichas a la vez y dejar una nota interna.
- **Descartar:** al marcar una ficha como Descartado, desaparece al instante de la lista y queda en el **Apartado de descartadas** (botón sobre los resultados o la tarjeta "Descartadas"), con quién la descartó y cuándo. Desde ahí puedes **Restaurar para revisar** o asignarle una categoría. Cada acción se puede deshacer en el aviso que aparece abajo.
- **Resúmenes de RCA:** cada resolución tiene un mini resumen con titular, descripción, objetivo, alcance y monto de inversión. Se ve en la ficha de la RCA y en la vista **Resúmenes de RCA**. Los resúmenes se basan en el texto de cada RCA; si el monto no aparece en la resolución, se usa el del consolidado y se indica.
- **Lista de resoluciones:** a la izquierda, agrupada por operación (Minera Centinela, Compañía Minera Zaldívar y Minera Antucoya) en grupos desplegables.
- **Qué ven los usuarios:** solo las fichas categorizadas que marques como **Visible para usuarios**, con su categoría. También pueden buscar palabras en el texto completo de las RCA visibles, pero sin ver categorías ni notas de lo que no habilitaste. Puedes ocultar una RCA completa desde su ficha. En la versión de Vercel este filtro lo aplica el servidor.
- Las RCA escaneadas se leyeron con reconocimiento óptico (OCR) y la plataforma lo indica. Su texto puede tener errores: antes de citar, revisa el documento original o el expediente del SEIA, que tiene un enlace en la ficha de cada RCA.
- Tablas en Supabase: `rca_base`, `rca_estado` y `rca_visibilidad` (incluidas en `supabase/schema.sql`).

## Uso diario
- **Actualizar datos** (solo administradores): sube un Excel nuevo y elige **Agregar solo filas nuevas** o **Reemplazar todos los datos**. Todos los usuarios ven los datos nuevos al volver a entrar.
- **Administración** (solo administradores; el servidor rechaza estas acciones si las intenta otro nivel):
  - **Agregar usuario**: crea la cuenta directamente con usuario, nombre, cargo, área, contraseña inicial, nivel y permisos. Queda activa de inmediato.
  - **Editar**: cambia nombre, cargo, área, nivel (Administrador o Visualizador), comunas visibles, ver nombres y exportar a CSV.
  - **Contraseña**: asigna una contraseña nueva a cualquier usuario. Las sesiones abiertas de ese usuario se cierran.
  - **Suspender** o **Reactivar** el acceso sin borrar la cuenta.
  - **Eliminar** la cuenta (pide confirmación y no se puede deshacer).
  - Aprobar o rechazar las solicitudes creadas desde **Crear cuenta**.
  - Revisar el historial de cargas.
  - Para no quedar sin acceso: no puedes suspender, eliminar ni bajar de nivel tu propia cuenta, y siempre debe quedar al menos un administrador activo.
- **Cierre de sesión**: con el botón **Cerrar sesión**, tras 30 minutos sin uso, o a las 8 horas.

### Restablecer una contraseña olvidada
Lo normal es que un administrador use el botón **Contraseña** en la pestaña Administración. Si el único administrador olvidó la suya:
1. En tu computador, dentro de esta carpeta, ejecuta: `npm run hash -- "NuevaContraseña"`.
2. En Supabase, abre **Table editor > usuarios**, busca al usuario y pega el resultado en la columna **hash**.

## Otros hostings
- **Render, Railway, Fly.io o un servidor propio con Node 18 o superior:**
  - Comando de inicio: `npm start` (usa `server.js`).
  - Carga las mismas variables de entorno.
  - Usa HTTPS en producción.
- **Netlify:** las funciones de `api/` están escritas para Vercel. En Netlify es más simple usar Render.

## Probar en tu computador
1. Copia `.env.example` como `.env` y completa los valores.
2. Agrega `COOKIE_INSECURE=1` para poder usar http://localhost sin HTTPS.
3. Ejecuta `npm start` y abre http://localhost:3000.
