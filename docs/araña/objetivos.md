# Objetivos de ALT RADAR PRO

Lo escribe una persona. La araña (`scripts/arana.mjs`) lo lee y asigna cada archivo a un objetivo por su ruta:
gana el primer objetivo cuyo patrón coincide, así que los específicos van antes que los generales.
Después de cambiarlo: `npm run arana`.

## Sinónimos
Para `--buscar`: el tema en español encuentra el código en inglés.
voz: voice, speech, tts, audio, dictado
alerta: alert, alerts, notify, push, aviso
riesgo: risk
memoria: memory, notes
senal: signal, signals, senales
velas: klines, candles, candle
precio: price, prices, ticker
liquidacion: liquidation, liq, magnet, imanes
iman: magnet, magnets
aprender: learn, learning, model, lecciones
aprendizaje: learn, learning, model
tesis: thesis, mind
mente: mind, reading, lectura
nucleo: core
pantalla: screen, panel
bot: telegram, webhook, chat
diario: journal
cuenta: account
ia: ai, brain, cascade, llm
cerebro: brain, cascade
neuronas: workers, neurons, quota
cupo: quota, limit, allowance
muestra: sample, record
analisis: analyst, analysis, analyze
analizar: analyst, analysis, analyze
mapa: heatmap, map
salud: health, status
despliegue: deploy, workflow, wrangler, worker
base: d1, database, sql, table
tabla: table, sql
clave: secret, key, token
claves: secret, key, token
seguridad: auth, secret, session
sesion: session, auth
robot: robot, bot, paper
papel: paper
manos: hands, hand, libres, freehands
libres: free, hands, manos
dictado: dictation, recognition, reconocimiento, stt
transcripcion: transcription, transcribe, whisper, groq, stt

## jarvis — JARVIS, la IA propia del software
Texto: asistente de voz y análisis dentro de la app, con su núcleo 24/7 en el servidor: cascada de cerebros, memoria por persona, lectura horaria (MENTE), analista de cada activo, voz neural y manos libres.
Archivos: lib/jarvis*.ts, lib/hands-free*.ts, lib/ai-*.ts, lib/assistant/**, lib/speech-text.ts, lib/browser-voice.ts, app/jarvis*, app/assistant-console.tsx, app/api/jarvis/**, app/api/analyst/**, app/api/telegram/webhook/**
Reglas:
- Identidad: «JARVIS — ALT RADAR PRO AI». Nunca se presenta como otra IA ni nombra el modelo.
- El navegador nunca llama a un proveedor de IA: pasa por /api/analyst/ai o /api/jarvis/*. Las claves nunca salen del Worker.
- Solo se recuerda lo que la persona pidió recordar (lib/jarvis-memory.ts) y va en cada pregunta.
- Cascada: Claude (25 por persona y día, pago) → Groq (gratis con clave) → Workers AI (Qwen3, 3.500 neuronas/día) → motor local del navegador (sin límite).
- Claude nunca en tareas programadas: cuesta por respuesta.
- Los números van a las IAs ya en formato argentino (lib/ai-numbers.ts): copian, no convierten.
- JARVIS TRADING (lib/jarvis-desk*.ts): la mesa de especialistas es determinista y corre en el navegador; ninguna IA decide la dirección, solo la conversa con los números de la mesa.
- La mesa lee solo velas cerradas (test de no mirar el futuro). Un especialista sin datos pesa cero y lo dice: «Este dato no está disponible actualmente.».
- El puntaje de confluencia no es una probabilidad. El gestor de riesgo veta (R:R menor a 1,5, stop absurdo, contra la mesa) y espera (evento de alto impacto en menos de 2 h); el veto gana a cualquier confianza.
- Análisis, papel y ejecución real están separados: la mesa nunca opera sola.
- Paper trading (lib/jarvis-paper*.ts, tablas jarvis_paper y jarvis_paper_counts): solo sigue planes que el gestor de riesgo aprobó; reglas fijas al abrir (un tercio por TP, stop fijo, peor caso primero, comisiones, 7 días). Se resuelve en el navegador con velas de Binance; el servidor no acepta cambios de plan ni retrocesos y recalcula el resultado.
- El aprendizaje es una observación medida con su muestra: nunca cambia las reglas de la mesa.
- Backtesting (lib/jarvis-backtest*.ts): la misma mesa y las reglas del papel sobre velas pasadas, una operación a la vez; en cada cierre de 4 h solo ve lo cerrado (test de no mirar el futuro). Lo que no tiene historial (derivados, noticias, sentimiento, calendario) pesa cero y se dice. Nunca se presenta como garantía.
Pendiente:
- Cargar la clave gratis de Groq en CONFIGURACIÓN: hace más rápida a MENTE (sin ella usa Workers AI).
- Mesa: faltan clientes de Bybit y OKX, la clave CMC_API_KEY y el historial real de liquidaciones; TradingView no tiene API pública.

## honestidad — Nunca inventar: probabilidades, precios, noticias
Texto: transversal a todo el producto. Lo que no se sabe se dice, no se estima a escondidas.
Archivos: —
Reglas:
- Ninguna probabilidad inventada. Todo porcentaje va con su tamaño de muestra; menos de 15 es «muestra mínima».
- Desconocido no es cero: si falta un dato, se muestra como falta.
- Señales y calculadoras llevan «no es asesoramiento financiero».
- Si una vela toca stop y objetivo, cuenta el stop.
- No simular análisis: si se dice «analizando», tiene que haber un proceso detrás.
- Nunca inventar noticias ni precios; si no hay datos, se dice y se corta.

## senales-radar — Radar de señales, a punto de romper, imanes y estructura
Texto: lo que el software detecta en el mercado: señales, presión antes de romper, zonas de liquidación, estructura y niveles.
Archivos: lib/radar*.ts, lib/signal*.ts, lib/pre-breakout*.ts, lib/pump-*.ts, lib/scalp*.ts, lib/liquidation-*.ts, lib/magnet-*.ts, lib/liq-vol-*.ts, lib/order-*.ts, lib/footprint*.ts, lib/key-levels*.ts, lib/level-engine*.ts, lib/structure-*.ts, lib/market-structure*.ts, lib/fair-value-gaps*.ts, lib/inducement*.ts, lib/liquidity-*.ts, lib/mtf-zones*.ts, lib/fib-*.ts, lib/chart-patterns*.ts, lib/oscillators*.ts, lib/big-trades*.ts, lib/trade-bubbles*.ts, lib/decoupling*.ts, lib/institutional*.ts, lib/scenario-*.ts, lib/swing-*.ts, lib/asset-read*.ts, lib/automation*.ts, lib/brain-security*.ts, lib/reversal-zones*.ts, lib/spot-*.ts, lib/squeeze*.ts, lib/supply-demand*.ts, lib/trading-profiles*.ts, lib/trendlines*.ts, lib/volume-spike*.ts, app/radar*.tsx, app/liquidation*.tsx, app/prebreak*.tsx, app/pump*.tsx, app/scalp*.tsx, app/futures-desk*.tsx, app/market-brain*.tsx, app/api/signals/**, app/api/radar/**, app/api/liquidity-history/**, app/api/scalping/**, app/api/backtest/**, app/api/brain/**
Reglas:
- Una señal lleva entrada, stop y objetivo fijados al detectarla; se mide sola contra el precio (resolveSignal).
- El mapa de liquidaciones es un modelo sobre apalancamiento asumido: se dice que es estimado.
Pendiente:
- Alertas de volumen siguen silenciosas desde el 30/09: Binance solo. Falta la decisión de Uri (Coinbase/Kraken con aviso).

## datos-mercado — Velas, precios, noticias y frescura
Texto: de dónde vienen los precios, velas, noticias y flujos, y cuánto pueden tardar. Siempre se dice la fuente.
Archivos: lib/klines*.ts, lib/market-*.ts, lib/live-*.ts, lib/upstream-cache*.ts, lib/shared-cache*.ts, lib/etf-flows*.ts, lib/exchange-reserves*.ts, lib/token-unlocks*.ts, lib/econ-calendar*.ts, lib/crypto-news*.ts, lib/news-*.ts, lib/fear-greed*.ts, app/binance-klines*.ts, app/api/klines/**, app/api/tickers/**, app/api/rolling/**, app/api/orderbook/**, app/api/market-structure/**, app/api/structure-trend/**, app/api/etf-flows/**, app/api/exchange-flows/**, app/api/institutional/**, app/api/calendar/**, app/api/sentiment/**
Reglas:
- Binance responde 403 al Worker (cron): fuera de Binance se usa Kraken o Coinbase en USD, solo para precio y estructura, con `venue` visible.
- Nunca Binance.US para volumen (es mínimo). Nunca Kraken/Coinbase para alertas de volumen ni para XAU/XAG.
- Un dato viejo se rechaza (maxAgeMs). Nunca se completa con otro.
- Si el origen no entrega, la ruta responde 503 con «SIN DATOS», no un valor.

## binance-usuario — Cuenta de Binance del usuario
Texto: lectura de la cuenta y operaciones con claves del usuario, siempre desde su navegador.
Archivos: lib/binance-*.ts, lib/futures-log*.ts, app/api/binance/**
Reglas:
- Las llamadas firmadas se hacen solo desde el navegador por WebSocket (lib/binance-client-signed.ts). REST firmado no funciona: CORS y firewall.
- Las claves de usuario no pueden tener retiros habilitados.
- Nunca loguear credenciales ni claves.

## telegram — Bot: alertas 24/7, comandos y chat con JARVIS
Texto: el canal que trabaja con la app cerrada: manda alertas, responde preguntas y comandos, y recibe notas de voz.
Archivos: lib/telegram*.ts, lib/price-alerts*.ts, app/api/telegram/**, app/telegram-card.tsx
Reglas:
- Cada evento se manda una sola vez (telegram_sent).
- El webhook exige el secreto de Telegram y siempre responde 200 para que Telegram no reintente.
- Una pregunta por Telegram usa la misma memoria y la misma cascada que la app.
Pendiente:
- Notas de voz: con Groq si está la clave; si no, Whisper de Workers AI dentro del cupo gratis diario.

## alertas — Avisos de la app: push del navegador y centro de alertas
Texto: lo que llega al navegador o al celular cuando algo pasa.
Archivos: lib/alert*.ts, lib/web-push*.ts, app/alert-center.tsx, app/alert-toasts.tsx, app/api/alerts/**, app/api/push/**
Reglas:
- Una suscripción sin endpoint o sin claves no se guarda: no podría recibir nada.
- Dejar de recibir tiene que borrar la fila de verdad.

## riesgo-diario — Riesgo, diario de operaciones, DCA y costo promedio
Texto: calculadoras y registros de la persona: cuánto arriesga, qué compró, a qué precio y cómo le fue.
Archivos: lib/risk*.ts, lib/trade-journal*.ts, lib/diario*.ts, lib/dca*.ts, lib/cost-basis*.ts, lib/account-journal*.ts, lib/futures-risk*.ts, lib/bot-journal*.ts, app/diario*.tsx, app/risk*.tsx, app/dca*.tsx, app/trade-journal*.tsx, app/api/journal/**, app/api/dca/**, app/api/diario/**, app/api/performance/**, app/api/bot/journal/**
Reglas:
- Capital primero: se advierte el riesgo alto y nunca se prioriza una ganancia posible sobre la protección.
- Las calculadoras llevan «no es asesoramiento financiero».
- El tamaño de la posición sale de la cuenta y del riesgo elegido, nunca de un número inventado.

## robots-papel — Robots y bots de papel (simulación)
Texto: operaciones simuladas para medir ideas. No mueven dinero real.
Archivos: lib/robot*.ts, lib/paper-bot*.ts, lib/mm-robot*.ts, app/robot*.tsx, app/api/robot/**
Reglas:
- Ninguna operación real sin autorización explícita. Las herramientas que actúan piden permiso; las que leen no.
- Todo resultado de papel se marca como simulado.

## d1-presupuesto — Base D1 y presupuesto gratis
Texto: transversal. Plan gratuito: 5 millones de filas leídas por día, ya superado más de una vez.
Archivos: —
Reglas:
- Nunca COUNT(*) sobre tablas que crecen: un contador de una fila por persona.
- Consultas por índice y con LIMIT. Nada de pedir historial desde el navegador en intervalos cortos ni en pestañas ocultas.
- Tablas nuevas: CREATE TABLE IF NOT EXISTS al primer uso. Migraciones en drizzle/ solo si hacen falta.
- Un cupo diario se cuenta en una fila por persona y una para todos, nunca con COUNT.

## despliegue — Worker, CI y migraciones
Texto: cómo llega el código a producción, cómo corre en el Worker y la configuración del proyecto.
Archivos: worker/**, wrangler*.jsonc, .github/workflows/**, drizzle/**, db/**, scripts/write-build-info.mjs, package.json, lib/app-settings*.ts, app/api/version/**, *.config.ts, *.config.mjs, tsconfig.json, next-env.d.ts, .gitignore, .openai/**, examples/**, README.md, THIRD_PARTY_NOTICES.md
Reglas:
- No tocar .github/workflows/ ni wrangler*.jsonc salvo pedido explícito.
- Antes de proponer un cambio: npm ci, npm run lint, npm run test:unit (con TZ=UTC) y npm run build. Los tres pasan.
- Al mergear a main, el CI despliega solo (lint, tests, build, migraciones D1, deploy).
- Los crons del Worker corren 24/7 aunque la app esté cerrada.
- examples/ es una plantilla de la plataforma: no es parte del producto.

## seguridad — Sesiones, secretos y claves
Texto: quién entra, cómo se guardan los secretos y qué nunca sale del servidor.
Archivos: lib/auth*.ts, lib/secret*.ts, app/api/auth/**, app/api/admin/**, app/sign-in*.tsx
Reglas:
- Nunca commitear claves, tokens ni contraseñas. Nunca loguear credenciales.
- Las claves de IA y de exchanges se leen con getSecret y nunca llegan al navegador.
- Las rutas que tocan datos de una persona exigen sesión (getSessionUser).
Pendiente:
- Borrar en Cloudflare el token «Altradar 2» y rotar los tokens que quedaron a la vista en el chat.

## araña — La araña del proyecto y las instrucciones para trabajar en él
Texto: el mapa del proyecto que se consulta sin gastar tokens: qué hace cada archivo, de quién depende y qué objetivo cumple.
Archivos: scripts/arana.mjs, docs/araña/**, tests/arana.test.ts, CLAUDE.md
Reglas:
- Antes de leer archivos enteros: `npm run arana -- --buscar <tema>` o `--archivo <ruta>`.
- Después de agregar, mover o borrar archivos, o cambiar estos objetivos: `npm run arana`. `npm run test:unit` avisa si el mapa quedó viejo.
- La araña lee el código sin ejecutarlo: lo que se arma en tiempo de ejecución no aparece, y el mapa lo dice.

## calidad — Pruebas
Texto: node:test sobre TypeScript sin compilar. Todo cambio de lógica trae su prueba.
Archivos: tests/**
Reglas:
- Los tests de datos de mercado incluyen uno que prueba que no se mira el futuro.
- Nada de parámetros de propiedades ni enums en código que corre en tests; imports dentro de lib/ con extensión .ts.
- Una prueba no se borra ni se salta para que pase: se arregla el código.

## app-movil — Interfaz, PWA y celular primero
Texto: la app que se ve y se usa, pensada primero para el celular (mobile first) y después tablet y escritorio.
Archivos: app/*.tsx, app/*.css, app/*.ts, public/**, lib/account-events*.ts, lib/visible-interval*.ts
Reglas:
- Celular > tablet > escritorio. Nada sale de la pantalla ni hay scroll horizontal; margen lateral de 16 px.
- Todo texto visible va en español rioplatense (vos, «comprá», decimales con coma).
- Las reglas de React: el setState de un efecto va después del primer await.
- Los tipos compartidos viven en lib/. El código de cliente nunca importa rutas de app/api/.
