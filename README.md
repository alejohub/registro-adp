# registro-adp

Extensión de navegador (Edge / Chrome / Firefox, Manifest V3) que rellena con un clic los días pendientes del registro de entradas/salidas en ADP (`www.adpnet.esp.adp.com`).

## Qué hace

- Lee el calendario del mes que tengas seleccionado en ADP y lista los días laborables anteriores a hoy que siguen pendientes.
- Registra dos marcas de TRABAJO (entrada y salida) por día usando el propio formulario "Registro manual" de ADP, y comprueba que se han guardado.
- Horario por defecto (editable en el popup, formato 24 h):
  - Lunes a jueves: 09:00–18:30
  - Viernes: 08:00–15:00
  - Agosto (todos los días, incluido viernes): 08:00–15:15
- Cada día tiene un check **Vacaciones** para registrarlo como ausencia de jornada completa (motivo "Vacaciones").
- Si un día ya tiene la entrada, añade solo la salida. Si tiene marcas con otras horas, lo omite para que lo revises a mano.

No guarda credenciales: usa la sesión que ya tengas abierta en ADP.

## Instalación

### Edge / Chrome

1. Abre `edge://extensions` (o `chrome://extensions`).
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar desempaquetada** y elige la carpeta `extension/`.

Tras actualizar el código, pulsa recargar en la extensión y comprueba la versión en la cabecera del popup.

### Firefox

Requiere **Firefox de escritorio 158 o posterior**. La prueba funcional se ha realizado con Firefox 158.0.1; no se declara compatibilidad con Android ni con versiones anteriores.

1. Descarga `registro-adp-firefox-v1.0.2.zip` desde la [release v1.0.2](https://github.com/alejohub/registro-adp/releases/tag/v1.0.2) y descomprímelo.
2. Abre `about:debugging#/runtime/this-firefox`.
3. Pulsa **Cargar complemento temporal** y selecciona el `manifest.json` de la carpeta descomprimida.
4. Abre ADP con la sesión iniciada y accede a la extensión desde el botón de extensiones de Firefox. Comprueba que muestra `v1.0.2`.
5. Si Firefox solicita acceso al sitio de ADP, concédelo para que pueda leer el calendario y usar sus formularios.

**Este paquete no está firmado:** la carga es temporal y debes repetirla después de cerrar Firefox. Para una instalación permanente se necesita un XPI firmado por Mozilla; este ZIP no se instala desde `about:addons`. Véase la [documentación de firma de Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

La versión de Firefox mantiene los horarios, las vacaciones y los reintentos de la versión de Chrome. Usa `browser.scripting.executeScript` en el mundo `MAIN` para acceder a GeneXus, y guarda tus preferencias de horario en `browser.storage.local`, solo en ese perfil de Firefox. Las preferencias de Chrome no se importan ni se sincronizan.

Los únicos datos enviados por su funcionamiento son los necesarios para los formularios del propio ADP, incluido el identificador del empleado y las marcas o vacaciones que selecciones. El manifiesto de Firefox declara esos datos (`personallyIdentifyingInfo` y `websiteActivity`). No incorpora analítica ni envía información a servicios del desarrollador.

## Generar y validar la versión de Firefox

Se usa un único código fuente: `extension/` sigue siendo la extensión de Chrome/Edge. `firefox/manifest.overrides.json` añade la identidad, versión mínima y declaración de datos de Firefox. El generador copia los recursos y adapta exclusivamente `chrome.*` a `browser.*` y el almacenamiento de horarios a `storage.local`.

Con Node.js 22 o posterior y pnpm:

```powershell
pnpm install --frozen-lockfile
pnpm build:firefox
pnpm test
pnpm lint:firefox
pnpm test:firefox
```

El resultado está en `dist/firefox/` (carga temporal) y `dist/registro-adp-firefox-v1.0.2.zip` (distribución). El ZIP es reproducible y contiene `manifest.json` en la raíz.

`test:firefox` usa Selenium con un perfil nuevo y un servidor local que simula ADP. Puede descargar Firefox y su controlador si no están disponibles. Prueba la interfaz, el escaneo, los formularios con GeneXus, las jornadas parciales, las vacaciones y la persistencia. El paquete de prueba añade únicamente un permiso para ese servidor local y dirige la selección de pestaña al ADP ficticio; el paquete publicado conserva solo el dominio de ADP. No accede a una cuenta real ni modifica registros reales. Para fijar una versión: `$env:FIREFOX_VERSION = '158.0.1'` antes del comando.

## Uso

1. Inicia sesión en ADP y abre el registro de entradas/salidas.
2. Pulsa el icono de la extensión → **Buscar días pendientes**.
3. Revisa la lista, marca las vacaciones si las hay → **Rellenar días seleccionados**.

## Limitaciones

- Solo procesa el mes que esté seleccionado en el calendario de ADP.
- Depende de la estructura actual de las páginas de ADP (GeneXus); si ADP cambia, puede dejar de funcionar.
