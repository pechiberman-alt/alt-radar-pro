# Diario de tu cuenta real de Axi

Qué es: el diario de las ejecuciones de tu cuenta MT5 de Axi. Es de solo lectura y va en USC (centavos de dólar: 100 USC = 1 USD).
Está en el laboratorio, en la sección «Cuenta real de Axi · diario», debajo del panel de fondeo.

## Cómo llegan los datos

- La app no se conecta sola a Axi. El conector de Axi vive en tu chat con Claude.
- Para cargar el historial, pedile a Claude que lea las ejecuciones de la cuenta y pegá el JSON en el panel, o subí el archivo `.json`.
- Cada ejecución se valida una por una. Si falta un dato que hace falta (resultado, swap, comisión, precio, volumen, hora), se rechaza
  y el panel dice en qué posición venía y por qué. Nada se completa con cero.
- Importar dos veces lo mismo no duplica nada: la clave es el id de la ejecución (dealId), por persona.
- Los movimientos de saldo (depósitos, retiros, cargos) se guardan aparte y no cuentan como operaciones.

## Qué muestra

- **Cierres**: las ejecuciones que cierran o reducen una posición. Es la muestra: menos de 15 es muestra mínima.
- **Neto de operaciones**: resultado + swap + comisión, en USC.
- **Saldo**: depósitos y retiros, por separado.
- **Por mes** y **por símbolo**.

## Qué no muestra todavía

- **Acierto, profit factor y expectancia.** Salen solo del registro unificado (`lib/registro.ts`), y para eso cada operación necesita
  su R: el stop conocido y el tamaño del contrato. Estas operaciones todavía no lo tienen, así que no se calcula ningún porcentaje acá.
- **Sincronización automática.** Para hacerla hay que decidir cómo se guarda el acceso a Axi en la app. Eso no está hecho.

## Límites

- Hasta 500 ejecuciones por persona. Si se pasa, el pedido completo no se guarda y el panel lo dice.
- Las cifras van en USC. El equivalente en USD es orientativo.
- Es una medición de tu cuenta, no una recomendación. No es asesoramiento financiero.

## Archivos

- `lib/axi-diario.ts`: validación, neto y resumen (puro, con sus pruebas en `tests/axi-diario.test.ts`).
- `lib/axi-db.ts`: la tabla `axi_deals` en D1 (una fila por ejecución; con sus pruebas en `tests/axi-db.test.ts`).
- `app/api/axi/diario/route.ts`: GET (tu diario), POST (importar) y DELETE (borrar).
- `app/lab-axi-diario.tsx`: el panel.
