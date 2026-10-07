# ALT RADAR PRO — reglas del proyecto

Terminal de inteligencia de mercado cripto (marca url.fx). App React sobre un Cloudflare Worker (vinext),
base Cloudflare D1, bot de Telegram, crons del Worker. Producción: https://alt-radar-pro.pechiberman.workers.dev/

## La araña: mapa del proyecto (ahorra tokens)
- Antes de leer archivos enteros: `npm run arana -- --buscar <tema>` (en español o inglés), `--archivo <ruta>` (ficha), `--ruta <archivo>` (qué se revisa si lo cambiás), `--objetivo <nombre>`, `--tablas`, `--secretos`. Todo: `npm run arana -- --ayuda`.
- docs/araña/objetivos.md dice a qué objetivo pertenece cada archivo, con sus reglas y pendientes. Un archivo sin objetivo hace fallar `npm run test:unit`: agregalo ahí.
- Después de agregar, mover o borrar archivos, o cambiar código y objetivos: `npm run arana` y commiteá docs/araña/ junto con el cambio. `npm run arana -- --cambios` dice qué cambió desde el último mapa.
- No leas docs/araña/MAPA.md entero: es el mapa completo; usá las consultas.

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

## IA de JARVIS y del ANALISTA
- Cascada (`lib/ai-cascade.ts`): Claude (25 por usuario y día, se paga) → Groq si hay clave gratis → Workers AI (Qwen3, hasta
  3.500 neuronas/día) → motor local del navegador (`lib/jarvis-local.ts`, sin límite). La respuesta dice qué cerebro habló.
- Las 10.000 neuronas gratis por día se reparten con la voz premium (2.200 caracteres ≈ 6.000). Subir una obliga a bajar la otra.
- Memoria por usuario (`lib/jarvis-memory.ts`): solo lo que la persona pidió recordar; va en cada pregunta.
- Analista propio (`lib/jarvis-analyst.ts`): todos los motores sobre un activo en 1h/4h/1d; corre en el navegador (CPU del Worker).
- MENTE (`lib/jarvis-mind.ts`): lectura horaria en el servidor (hh:17 UTC) con IA gratis; sus tesis son señales fuente "IA",
  se resuelven como cualquier señal y su historial vuelve al prompt. Nunca se usa Claude en tareas programadas (se paga).
- Los datos llegan a las IAs con los números ya en formato argentino (`forAi` de `lib/ai-numbers.ts`): el modelo los copia, no
  los convierte (convirtiendo escribió "11.066,4" por 11,07). Niveles que vuelven como texto: `parseLevel`.

## Honestidad (marca url.fx)
- Ninguna probabilidad inventada. Todo porcentaje va con su tamaño de muestra (menos de 15 = "muestra mínima").
- Desconocido no es cero: si falta un dato, se dice y no se estima a escondidas.
- Señales y calculadoras llevan "no es asesoramiento financiero". Un resultado nunca se favorece: si una vela toca stop y objetivo, cuenta el stop.

## Seguridad
- Nunca commitear claves, tokens ni contraseñas. Nunca loguear credenciales.
- Las claves de Binance de los usuarios no pueden tener retiros habilitados.
