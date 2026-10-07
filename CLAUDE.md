# ALT RADAR PRO — reglas del proyecto

Terminal de inteligencia de mercado cripto (marca url.fx). App React sobre un Cloudflare Worker (vinext),
base Cloudflare D1, bot de Telegram, crons del Worker. Producción: https://alt-radar-pro.pechiberman.workers.dev/

## Antes de proponer un cambio
- `npm ci --no-audit --no-fund`, después `npm run lint`, `npm run test:unit` y `npm run build`. Los tres tienen que pasar.
- Todo cambio de lógica lleva tests en `tests/` (node:test). Los de datos de mercado incluyen un test de que no se mira el futuro.
- Al hacer merge a `main`, el CI despliega solo (lint, tests, build, migraciones D1, deploy).
- No tocar `.github/workflows/` ni `wrangler*.jsonc` salvo pedido explícito.

## Código
- Todo texto visible para el usuario va en español rioplatense (vos, "comprá", decimales con coma).
- Los tests corren con `node --test` sobre TypeScript sin compilar: nada de parameter properties ni enums;
  dentro de `lib/` los imports llevan la extensión `.ts`.
- Regla `react-hooks/set-state-in-effect`: en un efecto, el setState va después del primer `await` (IIFE async).
- Los tipos compartidos viven en `lib/`. El código de cliente nunca importa rutas de `app/api/`.

## Base de datos D1 (plan gratuito: 5 millones de filas leídas por día, ya se superó más de una vez)
- Nunca `COUNT(*)` sobre tablas que crecen: contador de una fila por usuario.
- Consultas por índice y con `LIMIT`. Nada de pedir historial desde el navegador en intervalos cortos ni en pestañas ocultas.
- Tablas nuevas: `CREATE TABLE IF NOT EXISTS` al primer uso. Migraciones en `drizzle/` solo si hacen falta.

## Binance
- Las llamadas firmadas con claves del usuario se hacen solo desde el navegador, por la API WebSocket
  (`lib/binance-client-signed.ts`). REST firmado no funciona: CORS en el navegador y firewall de Binance en el Worker.
- Datos públicos desde el Worker: `GLOBAL_BASES` de `lib/klines-server.ts`. Nunca Binance.US para volumen (es mínimo).
- Binance responde 403 a los crons del Worker (oct 2026). Con `outside: true`, `fetchKlinesServer` sigue con Kraken y Coinbase
  en USD: solo para precio y estructura, siempre diciendo la fuente (`venue`). Nunca para alertas de volumen ni para XAU/XAG.

## Honestidad (marca url.fx)
- Ninguna probabilidad inventada. Todo porcentaje va con su tamaño de muestra (menos de 15 = "muestra mínima").
- Desconocido no es cero: si falta un dato, se dice y no se estima a escondidas.
- Señales y calculadoras llevan "no es asesoramiento financiero". Un resultado nunca se favorece: si una vela toca stop y objetivo, cuenta el stop.

## Seguridad
- Nunca commitear claves, tokens ni contraseñas. Nunca loguear credenciales.
- Las claves de Binance de los usuarios no pueden tener retiros habilitados.
