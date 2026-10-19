# registro-adp

Extensión de navegador (Edge / Chrome, Manifest V3) que rellena con un clic los días pendientes del registro de entradas/salidas en ADP (`www.adpnet.esp.adp.com`).

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

1. Abre `edge://extensions` (o `chrome://extensions`).
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar desempaquetada** y elige la carpeta `extension/`.

Tras actualizar el código, pulsa recargar en la extensión y comprueba la versión en la cabecera del popup.

## Uso

1. Inicia sesión en ADP y abre el registro de entradas/salidas.
2. Pulsa el icono de la extensión → **Buscar días pendientes**.
3. Revisa la lista, marca las vacaciones si las hay → **Rellenar días seleccionados**.

## Limitaciones

- Solo procesa el mes que esté seleccionado en el calendario de ADP.
- Depende de la estructura actual de las páginas de ADP (GeneXus); si ADP cambia, puede dejar de funcionar.
