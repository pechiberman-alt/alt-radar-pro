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
escaner: scan, scanner, escanear, escaneo, escaneos, barrido
tablero: board, consejo, council, votos, votes
consejo: council, board, tablero, votos, votes
mesa: especialistas, specialists, consenso, consensus
consenso: consensus, voto, votos, votes
moneda: coin, coins, symbol, symbols, simbolo, simbolos, universo, universe
monedas: coin, coins, symbol, symbols, simbolo, simbolos, universo, universe
winrate: win, wr, acierto, aciertos, pf
acierto: winrate, hit, win
backtest: backtesting, retroprueba, historico, simulacion
comision: fee, fees, comisiones, costo, costos, costs, slippage
m15: 15m, 15min, quince
minutos: min, minutes, minute
agentes: agent, agents, ruflo, mcp, swarm, enjambre
ruflo: agentes, agent, agents, mcp, swarm, enjambre
subir: publicar, despliegue, deploy, fusionar
publicar: despliegue, deploy, publish, release, subir
fusionar: merge, pr, subir
capital: exposicion, exposure, equity
exposicion: exposure, capital
cinta: tape
registro: record, ledger

## jarvis — JARVIS, la IA propia del software
Texto: asistente de voz y análisis dentro de la app, con su núcleo 24/7 en el servidor: cascada de cerebros, memoria por persona, lectura horaria (MENTE), analista de cada activo, voz neural y manos libres.
Archivos: lib/jarvis*.ts, lib/mesa-medicion.ts, lib/mesa-sombra*.ts, lib/hands-free*.ts, lib/ai-*.ts, lib/assistant/**, lib/speech-text.ts, lib/browser-voice.ts, app/jarvis*, app/assistant-console.tsx, app/api/jarvis/**, app/api/analyst/**, app/api/telegram/webhook/**, docs/mesa-*.md, scripts/investigacion/**
Reglas:
- Identidad: «JARVIS — ALT RADAR PRO AI». Nunca se presenta como otra IA ni nombra el modelo.
- El navegador nunca llama a un proveedor de IA: pasa por /api/analyst/ai o /api/jarvis/*. Las claves nunca salen del Worker.
- Solo se recuerda lo que la persona pidió recordar (lib/jarvis-memory.ts) y va en cada pregunta.
- Cascada: Claude (25 por persona y día, pago) → Groq (gratis con clave) → Workers AI (Qwen3, 3.500 neuronas/día) → motor local del navegador (sin límite).
- Claude nunca en tareas programadas: cuesta por respuesta.
- Los números van a las IAs ya en formato argentino (lib/ai-numbers.ts): copian, no convierten.
- JARVIS TRADING (lib/jarvis-desk*.ts): la mesa de especialistas es determinista y corre en el navegador; ninguna IA decide la dirección, solo la conversa con los números de la mesa.
- Mapa de JARVIS TRADING: motor y reglas lib/jarvis-desk.ts; especialistas y pesos lib/jarvis-desk-agents.ts; datos lib/jarvis-desk-data.ts (el snapshot y el contexto compartido); correr y guardar la última lectura lib/jarvis-desk-run.ts; tablero lib/jarvis-council.ts; escáner lib/jarvis-scan.ts y lib/jarvis-scan-run.ts; papel lib/jarvis-paper.ts, lib/jarvis-paper-run.ts y lib/jarvis-paper-db.ts (la tabla); backtest lib/jarvis-backtest.ts y lib/jarvis-backtest-run.ts; alertas lib/jarvis-watch.ts y lib/jarvis-watch-run.ts; los tres modos y el ticket manual lib/jarvis-execution.ts. Pantallas: app/jarvis-trading.tsx (la mesa) con app/jarvis-council.tsx, app/jarvis-scan.tsx, app/jarvis-paper.tsx, app/jarvis-backtest.tsx y app/jarvis-watch.tsx; estilos app/jarvis-trading.css. Todo corre en el navegador salvo el papel (se guarda en D1 por /api/jarvis/paper) y el núcleo del servidor (lib/jarvis-core.ts: 20 monedas cada 15 minutos).
- La mesa lee solo velas cerradas (test de no mirar el futuro). Un especialista sin datos pesa cero y lo dice: «Este dato no está disponible actualmente.».
- El puntaje de confluencia no es una probabilidad. El gestor de riesgo veta (R:R menor a 1,5, stop absurdo, contra la mesa) y espera (evento de alto impacto en menos de 2 h); el veto gana a cualquier confianza.
- Análisis, papel y ejecución real están separados (lib/jarvis-execution.ts): JARVIS no envía órdenes, no hay código que lo haga (`REAL_ORDERS_FROM_JARVIS` es falso). Para plata real arma un ticket manual que solo aparece con todos los controles en verde (plan aprobado, lectura de menos de 10 min, precio en vivo dentro del plan, capital cargado, riesgo ≤ 2%, liquidación ≥ 3 stops) y la confirmación explícita de la persona.
- El gestor de riesgo juzga una entrada a mercado al precio en vivo (mark de futuros), no solo al cierre leído: si el R:R ahí ya no llega a 1:1,5, espera. Mide exposición y riesgo abierto de papel; si el tamaño no entra en el capital con un apalancamiento seguro, o el riesgo es ALTO con R:R menor a 1:2, es NO TRADE.
- Paper trading (lib/jarvis-paper*.ts, tablas jarvis_paper y jarvis_paper_counts): solo sigue planes que el gestor de riesgo aprobó; reglas fijas al abrir (un tercio por TP, al cobrar el TP1 el stop pasa a la entrada —solo en las operaciones de reglas v2; las anteriores siguen con stop fijo—, peor caso primero, también dentro de la vela que cobra el TP1, comisiones, 7 días). Sin ventaja retrospectiva: cuentan solo los precios desde el minuto siguiente a abrirla (el servidor fija ese minuto con su reloj); a mercado entra al precio de ese minuto y no entra si ahí el R:R no llega a 1:1,5. La hora en que se abrió se revisa con velas de 1 minuto, después de 1 h; el cierre a mano revisa minuto a minuto hasta ahora. El servidor no acepta cambios de plan ni retrocesos y recalcula el resultado.
- Reglas v2 de la mesa (docs/mesa-reglas-v2.md): stop a 1 ATR del nivel, consenso mínimo ±0,30, stop a la entrada al cobrar el TP1. Cada operación guarda `reglas` y `gestion` y no se edita. Cambiar una regla exige medirla en los tres períodos, con costos más altos, y decir lo que no mejoró (tests/jarvis-rules-v2.test.ts fija las constantes).
- El aprendizaje es una observación medida con su muestra: nunca cambia las reglas de la mesa por su cuenta.
- Señales de JARVIS (ROMPE, IMÁN y las tesis IA de la MENTE) con escalera: su objetivo es el TP3 y resolveSignal guarda la hora de TP1/TP2 sin cambiar el resultado (un test lo compara con la regla de siempre en 300 señales). CORE las guarda en tp1_at/tp2_at (columnas agregadas al primer uso), una sola vez cada una.
- Laboratorio en sombra (lib/mesa-sombra.ts, -auditoria, -db, -run, -filtro; /api/jarvis/sombra; tablas mesa_sombra y mesa_sombra_eventos): evoluciona solo, en el navegador, variantes de FILTRO de una lista fija (GENES: confluencia, consenso a favor, cobertura, R:R, stop, lado, volatilidad), nunca código. Solo avanza con operaciones cerradas nuevas (papel y último backtest). Tres pasos sin mirar el futuro: elige con DESARROLLO (2/3, purgado), pasa VALIDACIÓN (tercio final, ≥15, mejor que la mesa y que cero) y se mide HACIA ADELANTE solo con operaciones abiertas después de descubrirla: APTA con ≥15, mejor que cero y que la mesa, PSR ≥ 0,95 corregido por candidatas (Bonferroni) y PBO < 50%; DESCARTADA si rinde menos o si con 60 no se distingue del azar. Nada cambia solo: aprobar (una APTA registrada como APTA en la auditoría) y revocar los pide la persona con confirmación y los decide el servidor sobre lo guardado; el navegador no puede tocar la aprobada. La aprobada solo frena papel nuevo (lib/mesa-sombra-filtro.ts en openFromDesk), nunca la ejecución real, y si empeora el laboratorio lo avisa pero no la revoca. Auditoría encadenada con SHA-256 (cada evento lleva el hash del anterior; el navegador la verifica y la araña muestra si está rota). D1: una fila de estado por persona, eventos por clave (user_id, seq) con LIMIT 40, una evolución registrada cada 20 minutos como mucho; sin sesión corre en memoria, sin auditoría ni aprobación.
- Tablero de mando (lib/jarvis-council.ts, app/jarvis-council.tsx): muestra por dentro la decisión de la mesa —voto, peso y aporte de cada especialista, las compuertas hasta la decisión— y, aparte y marcado PAPEL · SIMULADO, el capital en riesgo, la cinta y el registro del papel. No calcula nada nuevo sobre el mercado ni inventa una probabilidad: el consenso mide cuánto coinciden los especialistas; lo único medido es el registro del papel, con su muestra. Un riesgo sin calcular se cuenta aparte, no como cero. Usa los mismos umbrales que la mesa (`CONSENSUS_EDGE`, `AGAINST_EDGE`, `MAX_OPEN_RISK_PCT`): no los copia.
- Escáner de todo el mercado (lib/jarvis-scan.ts, lib/jarvis-scan-run.ts, app/jarvis-scan.tsx): lee con la misma mesa todas las monedas de futuros USDT con volumen mínimo (por defecto 5 millones de dólares en 24 h; sin dólares sintéticos, índices ni metales; tope de 400). Corre solo en el navegador, de a una moneda cada 700 ms (≈ 770 de los 2.400 de peso por minuto de Binance) y solo contra los espejos de futuros: nunca cae al Worker (`/api/klines` gasta D1) ni a Kraken o Coinbase (sin volumen). Se frena ante un 418 y espera ante un 429. Lectura rápida de todas (velas y datos compartidos; derivados y liquidaciones pesan cero y se dice) y relectura completa solo de las aprobadas (hasta 10): vale la completa. Moneda sin velas suficientes = SIN DATOS, nunca una decisión inventada. Cuenta monedas, no porcentajes; el orden por confluencia no es una probabilidad. Las reglas se midieron en 10 monedas grandes y en el resto no hay medición propia: se dice en pantalla. Es análisis: no abre papel ni ejecuta; el núcleo del servidor sigue leyendo 20 monedas. Por voz o chat de JARVIS (intención SCAN de lib/jarvis.ts, caso SCAN de app/jarvis.tsx): «escaneá el mercado» lo arranca y abre el bloque en la mesa, «¿cómo va?» y «¿qué dio el último?» informan (con la edad del escaneo y el aviso si ya está viejo), «cancelá el escaneo» lo corta, y el resultado se dice cuando termina; `scanProgressSpeech` y `scanAgeSpeech` de lib/jarvis-scan.ts arman las frases.
- Agregar una orden por voz o chat a JARVIS: el tipo en `JarvisIntent` y la regla en `parseCommand` (lib/jarvis.ts: gana la primera regla que calza, así que las frases nuevas van antes de las que podrían tragárselas; «pará» es STOP salvo que hable del escaneo, y «decime…» es un nombre solo si es lo último que se dice); el caso en `run` de app/jarvis.tsx (`speak(texto, etiqueta)`; lo que tarda minutos se contesta ya y se avisa al terminar con `latestRef.current.speak`); la frase en `HELP_TEXT`; y pruebas en tests/jarvis.test.ts con las frases que sí y las que no tienen que pisar a otras.
- Investigación de la mesa (scripts/investigacion/**, docs/mesa-perfiles.md, docs/mesa-aprendizaje.md): mide las reglas sobre velas pasadas, con otras velas base y con modelos; no corre en la app ni la toca. Ningún modelo ni probabilidad de ahí llega a la mesa salvo que su intervalo del 90% en el período de desarrollo quede por encima de cero y se confirme hacia adelante en papel. Si cambia el motor de la mesa hay que volver a validar el simulador contra el backtest real (`node --experimental-strip-types scripts/investigacion/medir.ts 1h --real BTCUSDT`).
- Win rate y profit factor medidos en las reglas v2 (docs/mesa-reglas-v2.md; 10 monedas, comisión de 0,05% por lado, una operación a la vez, sin derivados ni noticias históricos): el win rate pasa de 33–36% a 45–46% y el profit factor de 1,09 / 1,02 / 1,12 (v1) a 1,16 / 1,15 / 1,22 (v2) en los tres períodos largos, con casi la mitad de las operaciones, menor caída y un total en R parecido (+314 R contra +320 R). En los últimos 180 días v2 no mejoró (profit factor 1,10 contra 1,15, unas 300 operaciones: ruido). Parte de la suba del win rate es mecánica (cerca del 15% de las operaciones salen a la entrada con ganancia chica): se mira profit factor, expectativa y caída, no solo el win rate.
- Velas base, 15 minutos (m15) y más lentas (docs/mesa-perfiles.md): 15 min no tiene ventaja medida con comisiones (profit factor 0,99 con v1 y 1,03 con v2, con intervalos que incluyen 1; con 0,10% por lado pierde): el stop en precio es chico y 0,05% por lado se lleva 0,085 R por operación contra 0,040 R con 1 h. Más lento (2 h a 12 h) da mejor profit factor por operación pero muchas menos operaciones y el total en R no sube (+318 R con 1 h, +241 con 2 h, +20 con 12 h); lo que se ve ahí son sobre todo compras en años alcistas. La app sigue con velas de 1 h y no tiene selector de velas base.
- Aprendizaje de la mesa (docs/mesa-aprendizaje.md): se entrenaron 7 modelos hacia adelante (regresión logística, ridge y árboles; 27.968 decisiones, 35 datos) para ordenar las decisiones y ninguno cumplió el criterio fijado antes de mirar (el intervalo del 90% de «alta − baja» en desarrollo por encima de cero): no se adoptó ningún filtro ni probabilidad. Para volver a probar: scripts/investigacion/aprendizaje.ts y modelos.ts.
- Alertas de la mesa (lib/jarvis-watch*.ts): las configura la persona (activos, tipos, umbrales); corren en el navegador con la app abierta y visible, una vez por vela o evento, categoría MESA del centro de alertas. Liquidaciones: el tape real de Binance en vivo. Con la app cerrada, solo las de nivel por Telegram (/api/jarvis/alert, misma tabla que /alerta).
- Backtesting (lib/jarvis-backtest*.ts): la misma mesa y las reglas del papel sobre velas pasadas, una operación a la vez; en cada cierre de 4 h solo ve lo cerrado (test de no mirar el futuro). Lo que no tiene historial (derivados, noticias, sentimiento, calendario) pesa cero y se dice. Nunca se presenta como garantía.
Pendiente:
- Laboratorio en sombra: con poco papel cerrado no evoluciona (pide 15 en desarrollo y 15 en validación); correr backtests suma muestra. Ninguna variante aprobada todavía.
- Cargar la clave gratis de Groq en CONFIGURACIÓN: hace más rápida a MENTE (sin ella usa Workers AI).
- Mesa: la clave gratis de CoinMarketCap es opcional (CONFIGURACIÓN); TradingView no tiene API pública de datos (solo widgets y webhooks). /api/market/derivatives?symbol=BTCUSDT dice qué exchange contestó.
- Escáner del mercado: el primer escaneo real, con Binance y desde el navegador de la persona, está sin confirmar (se probó con una Binance simulada): mirar si aparece un 429 o un 418 y cuánto tarda.
- El núcleo del servidor (lib/jarvis-core.ts) sigue leyendo 20 monedas cada 15 minutos: ampliarlo cuesta filas leídas de D1 (5 millones por día) y CPU del Worker; el resto del mercado lo cubre el escáner del navegador.
- Reglas v2: lo que las confirma de verdad es el papel hacia adelante, con su muestra (menos de 15 operaciones es muestra mínima). Las 10 monedas medidas son grandes y de hoy (sesgo de supervivencia), sin deslizamiento ni financiamiento.

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
Archivos: lib/radar*.ts, lib/signal*.ts, lib/escalera*.ts, lib/pre-breakout*.ts, lib/pump-*.ts, lib/scalp*.ts, lib/liquidation-*.ts, lib/magnet-*.ts, lib/liq-vol-*.ts, lib/order-*.ts, lib/footprint*.ts, lib/key-levels*.ts, lib/level-engine*.ts, lib/structure-*.ts, lib/market-structure*.ts, lib/fair-value-gaps*.ts, lib/inducement*.ts, lib/liquidity-*.ts, lib/mtf-zones*.ts, lib/fib-*.ts, lib/chart-patterns*.ts, lib/oscillators*.ts, lib/big-trades*.ts, lib/trade-bubbles*.ts, lib/decoupling*.ts, lib/institutional*.ts, lib/scenario-*.ts, lib/swing-*.ts, lib/asset-read*.ts, lib/automation*.ts, lib/brain-security*.ts, lib/reversal-zones*.ts, lib/spot-*.ts, lib/squeeze*.ts, lib/supply-demand*.ts, lib/trading-profiles*.ts, lib/trendlines*.ts, lib/volume-spike*.ts, app/radar*.tsx, app/liquidation*.tsx, app/prebreak*.tsx, app/pump*.tsx, app/scalp*.tsx, app/futures-desk*.tsx, app/market-brain*.tsx, app/api/signals/**, app/api/radar/**, app/api/liquidity-history/**, app/api/scalping/**, app/api/backtest/**, app/api/brain/**
Reglas:
- Toda operación lleva SL, TP1, TP2 y TP3 fijados al detectarla (lib/escalera.ts): si nace con un solo objetivo, ese es el TP3 (el que se midió) y TP1/TP2 van a un tercio y dos tercios del camino. Se recorre solo con velas cerradas posteriores; si una vela toca SL y objetivo, cuenta el SL. Cada nivel queda con su hora.
- El mapa de liquidaciones es un modelo sobre apalancamiento asumido: se dice que es estimado.
Pendiente:
- Alertas de volumen siguen silenciosas desde el 30/09: Binance solo. Falta la decisión de Uri (Coinbase/Kraken con aviso).

## datos-mercado — Velas, precios, noticias y frescura
Texto: de dónde vienen los precios, velas, noticias y flujos, y cuánto pueden tardar. Siempre se dice la fuente.
Archivos: lib/klines*.ts, lib/market-*.ts, lib/live-*.ts, lib/upstream-cache*.ts, lib/shared-cache*.ts, lib/etf-flows*.ts, lib/exchange-reserves*.ts, lib/token-unlocks*.ts, lib/econ-calendar*.ts, lib/crypto-news*.ts, lib/news-*.ts, lib/fear-greed*.ts, app/binance-klines*.ts, app/api/klines/**, app/api/tickers/**, app/api/rolling/**, app/api/orderbook/**, app/api/market-structure/**, app/api/structure-trend/**, app/api/etf-flows/**, app/api/exchange-flows/**, app/api/institutional/**, app/api/calendar/**, app/api/sentiment/**, app/api/market/**, tests/derivados-cache.test.ts
Reglas:
- Binance responde 403 al Worker (cron): fuera de Binance se usa Kraken o Coinbase en USD, solo para precio y estructura, con `venue` visible.
- Derivados con respaldo (lib/market-providers.ts): Binance Futures y después Bybit desde el navegador; si no responden, el servidor (/api/market/derivatives) prueba OKX, Hyperliquid, Bybit y Binance, en ese orden (medido en producción: OKX contesta al Worker con todo; Bybit lo rechaza por región). Un resultado sin ningún proveedor no se guarda en caché: el caché sirve la última lectura buena (parteDerivados, tests/derivados-cache.test.ts). Una sola fuente por lectura (nunca se mezclan campos de dos exchanges), funding llevado a 8 h, y la fuente se dice. Kraken Futures (sin clave) es el último respaldo y solo aporta precio de marca e interés abierto: su documentación no dice el período del funding, así que queda «sin datos» y no se estima; el contrato se busca por su par (BTC figura como XBT:USD). Exness y NinjaTrader no tienen API de datos y BingX no está verificado: no se conectan. Liquidaciones reales con historial: OKX, que es una parte del mercado y así se dice. Son APIs públicas: ninguna clave.
- CoinMarketCap solo con la clave del dueño (CONFIGURACIÓN o el secreto CMC_API_KEY), en el servidor, una lectura cada 15 min; sin clave, CoinGecko y CoinLore como siempre.
- Nunca Binance.US para volumen (es mínimo). Nunca Kraken/Coinbase para alertas de volumen ni para XAU/XAG.
- Peso de las consultas de velas a Binance Futures (límite de 2.400 de peso por minuto por conexión; 429 = esperar, 418 = conexión bloqueada por un rato): con limit menor a 100 pesa 1, de 100 a 499 pesa 2, de 500 a 1.000 pesa 5 y más de 1.000 pesa 10. Leer una moneda completa (1 h × 1.000, 4 h × 300, 1 d × 220) cuesta 9. Lo que lee muchas monedas va de a una cada 700 ms y desde el navegador (lib/jarvis-scan-run.ts), nunca desde el Worker.
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
Archivos: lib/telegram*.ts, lib/price-alerts*.ts, app/api/telegram/**, app/telegram-card.tsx, lib/telegram-moneda.ts, tests/telegram-moneda.test.ts, lib/arkham-ballenas.ts, tests/arkham-ballenas.test.ts
Reglas:
- Ballenas de Arkham (lib/arkham-ballenas.ts): con la clave de Arkham del administrador (CONFIGURACIÓN o el secreto ARKHAM_API_KEY), el cron de 5 minutos hace una consulta a GET /transfers (1 por segundo como máximo) y avisa por Telegram las transferencias on-chain de 5 M de dólares o más, con emisor y receptor según Arkham, valor histórico en USD y aviso de que no dice hacia dónde va el precio. Categoría BALLENAS, sin base de datos; una clave rechazada se registra, no se toma por "sin novedades".
- Monedas pedidas por nombre (lib/telegram-moneda.ts): si la persona pregunta por una moneda que JARVIS no vigila (ej. ONDO), el servidor trae su precio y sus velas de 4 h de Binance y le da al modelo una lectura corta con los indicadores del estudio, sobre velas cerradas; si Binance no reconoce el par, el bot lo dice. También le llegan el resumen del estudio del laboratorio (lib/estudio-resumen.ts) y el estado del agente de papel de la cuenta con su muestra. Hasta tres consultas por mensaje.
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
- Registro del ROBOT MM (lib/robot-ledger*.ts, tabla robot_senales, por cuenta): cada señal queda con su escalera aunque Telegram no esté vinculado, y se resuelve con las reglas de runMm (48 velas, 0,05% por lado; un test lo compara operación por operación). La resuelve el navegador con velas de Binance; el servidor revisa la coherencia, no deja reescribir lo cerrado y calcula el R.
- El bot de papel registra la hora de TP1/TP2 de cada operación y su escalera va en la nota del diario; sus salidas no cambian (stop primero, objetivo, tiempo, noticias).

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
Archivos: worker/**, wrangler*.jsonc, .github/workflows/**, drizzle/**, db/**, scripts/write-build-info.mjs, package.json, lib/app-settings*.ts, app/api/version/**, *.config.ts, *.config.mjs, tsconfig.json, next-env.d.ts, .gitignore, .openai/**, examples/**, README.md, THIRD_PARTY_NOTICES.md, lib/ia-editor.ts, scripts/ia-editor.mjs, docs/ia-editor.md
Reglas:
- Editor por IA (.github/workflows/ia-editor.yml, scripts/ia-editor.mjs, lib/ia-editor.ts, docs/ia-editor.md): el dueño comenta «/ia …» en un issue y un modelo gratis propone el cambio; se abre un PR para revisar, nunca se mergea solo. Solo edita archivos existentes de app/, lib/, tests/ y docs/ que se le mostraron; nunca workflows, scripts, dependencias, migraciones, claves ni el mapa. El lint y las pruebas corren sin el token ni la clave en el entorno. No agregar caminos que mergeen, desplieguen o toquen estas protecciones.
- No tocar .github/workflows/ ni wrangler*.jsonc salvo pedido explícito.
- Antes de proponer un cambio: npm ci, npm run lint, npm run test:unit (con TZ=UTC) y npm run build. Los tres pasan.
- Al mergear a main, el CI despliega solo (lint, tests, build, migraciones D1, deploy).
- Subir un cambio, paso a paso: rama nueva desde main; `npm ci`, `npm run lint`, `npm run test:unit` y `npm run build` (el build reescribe lib/build-info.ts: `git checkout lib/build-info.ts` después); `npm run arana` y commitear docs/araña/ junto con el cambio; push de la rama; PR por REST con `gh api repos/pechiberman-alt/alt-radar-pro/pulls` (`gh pr create` usa GraphQL, que en las sesiones de Claude Code en la nube está bloqueado); fusionar con `gh api -X PUT repos/pechiberman-alt/alt-radar-pro/pulls/<n>/merge -f merge_method=squash`. Los PR no tienen chequeos: el CI «Deploy ALT RADAR PRO» corre recién al fusionar a main, así que la barrera es correr los tres comandos antes.
- Confirmar el despliegue: el run de Actions del commit de merge (`gh api "repos/pechiberman-alt/alt-radar-pro/actions/runs?head_sha=<sha>"`) en success, y `/api/version?nocache=<sha de 7 letras>` en producción devuelve `build` con esas 7 letras. Desde el shell de la nube curl a workers.dev da 403: se mira con WebFetch.
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
Archivos: scripts/arana.mjs, scripts/arana-vista.html, scripts/arana-vivo.html, docs/araña/**, tests/arana.test.ts, lib/arana-vivo.ts, lib/arana-vivo-auto.ts, app/arana-vivo.tsx, app/arana-desk.tsx, app/arana-desk.css, tests/arana-vivo.test.ts, tests/arana-vivo-auto.test.ts, tests/mesa-medicion.test.ts, lib/arana-ultimo.ts, lib/arana-ultimo-db.ts, app/api/arana/ultimo/**, tests/arana-ultimo.test.ts, CLAUDE.md, .mcp.json, .claude/settings.json, scripts/herramientas.mjs, scripts/verificar.mjs, scripts/subir.mjs, scripts/claude-hooks.mjs, tests/herramientas.test.ts
Reglas:
- Antes de leer archivos enteros: `npm run arana -- --buscar <tema>` o `--archivo <ruta>`.
- Escalera para gastar poco: `--buscar <tema>` (archivos, la sección de los .md y las reglas que lo mencionan, cortadas a 200 letras) → `--regla <tema>` (el texto completo de esas reglas: muchas veces alcanza) → `--archivo <ruta>` (la ficha) → recién ahí leer. `--objetivo <nombre>` trae todas las reglas de un objetivo y pesa mucho: usarlo solo para ver el panorama.
- La descripción de cada archivo es el comentario que lo abre o, si no hay, el bloque `/** … */` de tres líneas o más que sigue a los imports (uno de una línea ahí describe a la primera función, no al archivo). Un archivo nuevo lleva ese comentario: sin él la búsqueda solo lo encuentra por su ruta y sus exportaciones.
- Una regla que se agrega a un objetivo se escribe con lo importante al principio (el nombre y la conclusión): `--buscar` muestra solo sus primeras 200 letras. Las palabras que la gente usa y el código no van como sinónimos arriba en este archivo.
- Después de agregar, mover o borrar archivos, o cambiar estos objetivos: `npm run arana`. `npm run test:unit` avisa si el mapa quedó viejo.
- La araña en vivo (lib/arana-vivo.ts, app/arana-vivo.tsx) solo muestra lo que la app leyó (incluido el registro unificado de /api/registro) y lo medido, cada cosa con su muestra y su intervalo. No ejecuta, no propone órdenes y no guarda nada más que el último escaneo completo de la cuenta (lib/arana-ultimo*.ts, tabla arana_ultimo, una fila por cuenta, solo con sesión): al entrar la araña lo muestra en vez de empezar de cero. Si falta un dato, dice «sin datos».
- Lo medido que muestra la araña (lib/mesa-medicion.ts) tiene que estar escrito en docs/mesa-reglas-v2.md con sus números; tests/mesa-medicion.test.ts lo chequea. Para cambiarlo, volver a medir con `medir.ts 1h --estadistica` y actualizar los dos.
- La mesa en vivo (EN VIVO, scripts/arana-vivo.html) es solo una vista: recibe la foto por postMessage desde la página madre, sin guardar nada ni pedir datos a la red, y sin botones que manden órdenes. Si cambia la forma de la foto, cambian a la vez lib/arana-vivo.ts, app/arana-vivo.tsx y la página (hay pruebas que lo cuidan).
- El escaneo automático (lib/arana-vivo-auto.ts) escanea como mucho cada 15 minutos, solo con la mesa a la vista y la pestaña visible; nunca dos a la vez; se pausa con un botón y un intento fallido también espera el intervalo entero (no reintenta en bucle contra Binance). Cambiar el intervalo cambia lo que cuesta a Binance: medirlo antes. Al entrar, la cadencia arranca desde el último escaneo guardado (inicio = fin − duración): si fue hace menos de 15 minutos, no escanea de nuevo; si no hay ninguno, el primero es al abrir la araña, y nunca decide antes de leer el guardado (ultimoEscaneoListo).
- La mesa aprende en sombra (laboratorio, docs/mesa-aprendizaje.md) pero no cambia sus reglas por su cuenta: una variante filtra el papel solo si la persona la aprueba, y nada toca la ejecución real. Las reglas de la mesa (el código) cambian solo por un PR revisado y medido; Ruflo sirve para estudiar estrategias fuera de la app (docs/mesa-referencias.md).
- La araña lee el código sin ejecutarlo: lo que se arma en tiempo de ejecución no aparece, y el mapa lo dice.
- La vista (`npm run arana -- --vista`) dibuja el mapa como una esfera de instrumentos: cada punto es un archivo, cada casquete de color un objetivo, los arcos son imports reales, los pinchos rosas banderas y la araña camina por los imports de cada objetivo. Alrededor, paneles con datos del mapa: cobertura, objetivos, cinta de lectura, líneas por objetivo, más importados, encaje y densidad de imports, radar, banderas, tablas/rutas/secretos (solo nombres) y consultas para Claude. Se genera, no se commitea (docs/araña/vista.html está en .gitignore).
- Honestidad de la vista: todo panel sale del mapa; lo que es adorno (malla fina entre vecinos, retícula, polvo) lo dice la leyenda y el pie. La posición de cada punto la calcula `esferaDe` en scripts/arana.mjs y es siempre la misma para el mismo proyecto (hay prueba). Un porcentaje lleva su n y menos de 15 es «muestra mínima»; lo que no se puede medir se muestra como «sin datos», no como cero.
- La app la muestra en LA ARAÑA (AVANZADO): el build corre `npm run arana -- --pagina` (prebuild) y deja public/arana/index.html, que `app/arana-desk.tsx` pone en un marco sandboxeado (sin allow-same-origin: con scripts y mismo origen la página podría quitarse el sandbox). La página no guarda nada ni pide nada a la red; solo avisa su alto por postMessage y el marco lo respeta si viene de él. Se genera, no se commitea; si el build no puede leerla deja una página que avisa y no falla.
- Ruflo (MCP de los agentes) vive en `.mcp.json` y `.claude/settings.json`, con versión, fecha y `--ignore-scripts` fijados; `tests/agentes-mcp.test.ts` lo vigila. No correr `ruflo init` acá: reescribe CLAUDE.md Expone solo los grupos que se usan (`CLAUDE_FLOW_MCP_TOOLS`): las 353 herramientas pesan ~66k tokens de esquema.
- Gastar pocos tokens: `npm run verificar` (araña, lint, tests, tsc y build) muestra solo lo que falla y anota el árbol que pasó; `npm run subir` sube solo ese árbol (rama, PR, squash, espera el deploy) y frena secretos, archivos nuevos sin seguimiento (salvo con `--incluir-nuevos`) y workflows o wrangler sin pedido. Los hooks de `.claude/settings.json` frenan leer entero un archivo de más de 600 líneas (ficha de la araña o por partes; con `limit` se puede) y editar secretos.

## registro — El registro unificado de operaciones: acierto, profit factor y expectancia de cada fuente
Texto: el único lugar donde la app calcula el acierto, el profit factor y la expectancia. Cada fuente (JARVIS, el bot de papel, el robot) con su muestra y su intervalo; lo que no se pudo leer dice «sin datos», no cero.
Archivos: lib/registro.ts, lib/registro-db.ts, lib/registro-run.ts, app/api/registro/**, lib/flujo.ts, lib/flujo-db.ts, lib/flujo-run.ts, lib/agente-st.ts, lib/agente-st-db.ts, lib/agente-st-run.ts, tests/registro.test.ts, tests/flujo.test.ts, tests/agente-st.test.ts
Reglas:
- Un resultado cuenta una sola vez: R mayor que 0 gana, menor que 0 pierde, igual a 0 empata. Las abiertas no entran al acierto. Una cerrada sin resultado conocido no cuenta ni como acierto ni como cero.
- Todo porcentaje va con su muestra y su intervalo de Wilson al 90 %; menos de 15 cerradas se marca «muestra mínima». El profit factor no se divide por cero: sin pérdidas dice «sin pérdidas».
- Nada fuera de este registro calcula aciertos. La araña y la app muestran estos números tal cual; el diario del bot es una copia del papel y no se cuenta dos veces. Las señales del radar (signal_records) no entran hasta definir qué es un acierto para un plan sin R.
- Capital simulado por bot (simularCapital de lib/registro.ts, el único lugar que lo calcula): USD 1.000 virtuales y 1 % fijo por operación (1 R = USD 10, sin interés compuesto), desde la primera operación registrada. El final sale exacto del neto en R del conteo; la caída máxima y la curva salen del orden real de los cierres (la de JARVIS, de las últimas 1.000 por el índice de cierre, compartida 5 minutos) y si la serie está recortada se dice. No se suman comisiones que la fuente no midió. Es dinero de simulación y así se dice en pantalla.
- Las lecturas son acotadas: por fuente se leen las últimas 1.000 operaciones y, si hay más o filas ilegibles, la fuente dice «incompleta». JARVIS usa sus contadores globales; la base no hace COUNT(*) sobre tablas que crecen.
- El laboratorio en sombra (JARVIS · señales en sombra) se muestra aparte y no entra en el total: no son operaciones.
- Agente de papel Supertrend MTF + Volumen (lib/agente-st.ts, PLAN_ST_1): la estrategia ST_MTF_VOL del estudio corriendo hacia adelante, solo en papel, desde el navegador (lib/agente-st-run.ts, con la pestaña visible y con sesión; velas públicas de Binance, nunca Kraken ni Coinbase porque la regla usa volumen). Solo largos y solo con BTC alcista (cierre sobre la EMA de 200 días y la de 50 sobre la de 200); entra a la apertura de la vela de 4 h que sigue a la señal y solo se registra dentro de la primera media hora de esa vela: lo que no se vio a tiempo no se rellena después. Plan con SL, TP1, TP2 y TP3 fijados al abrir (TP3 a 2 R, TP1 y TP2 a un tercio y dos tercios), 48 velas, comisión de 0,07 % por lado; el R lo calcula el servidor (validarRecorridoFlujo con la comisión de la regla). La «foto» de condiciones de cada entrada (volumen relativo, marco superior, IDM, compras agresivas) se guarda y no filtra nada; la regla solo cambia por un PR revisado. Tabla agente_st_senales, una fila por moneda y vela de señal.
- Flujo de órdenes (lib/flujo.ts, PLAN_FLUJO_1): una lectura de presión con dirección y puntaje de 60 o más es operación solo con plan completo de los niveles que ya calcula el libro (stop en el piso o techo más cercano del lado contrario, objetivo en el más cercano del lado de la dirección). Se mide con velas de 5 minutos, 48 velas, comisión de 0,05 % por lado; una lectura por símbolo, lado y media hora. La regla se fijó antes de medirla: cambiarla es un PR revisado, no un ajuste a los números.

## laboratorio — AI TRADING LAB: agentes, backtest evaluado, papel con riesgo central y la araña como centro de operaciones
Texto: el laboratorio multiagente en simulación. Junta lo que ya existe (especialistas de la mesa, backtest, papel, laboratorio en sombra, registro) en roles con entradas, salidas y estado real, con un gestor de riesgo central para toda operación simulada y JARVIS explicando los resultados. No opera con dinero real.
Archivos: lib/lab.ts, lib/lab-riesgo.ts, lib/lab-evaluacion.ts, lib/lab-jarvis.ts, lib/lab-run.ts, app/ai-trading-lab.tsx, app/ai-trading-lab.css, tests/lab.test.ts, lib/estrategias.ts, lib/estudio-estrategias-datos.ts, docs/estudio-estrategias.md, scripts/investigacion/estrategias.ts, app/lab-piso.tsx, tests/estrategias.test.ts, app/lab-agente-st.tsx, lib/estudio-resumen.ts, lib/sobreajuste.ts, tests/sobreajuste.test.ts, lib/preregistro-flujo.ts, tests/preregistro-flujo.test.ts, scripts/investigacion/preregistro-flujo.ts, scripts/investigacion/datos-binance.py, lib/linea-busqueda.ts, tests/linea-busqueda.test.ts, scripts/investigacion/linea-busqueda.ts, docs/busqueda-linea.md, lib/breaker-busqueda.ts, lib/smc-liquidez.ts, lib/fibonacci-niveles.ts, tests/breaker-busqueda.test.ts, tests/smc-liquidez.test.ts, tests/fibonacci-niveles.test.ts, scripts/investigacion/breaker-busqueda.ts, scripts/investigacion/smc-busqueda.ts, scripts/investigacion/fib-busqueda.ts, docs/busqueda-breaker.md, docs/busqueda-smc.md, docs/busqueda-fibonacci.md, lib/lab-arena.ts, tests/lab-arena.test.ts, app/lab-mini-arana.tsx, lib/fondeo.ts, tests/fondeo.test.ts, app/lab-fondeo.tsx, lib/practica-gatillo.ts, app/practica-gatillo.tsx, lib/aprender.ts, app/aprender-lab.tsx, tests/aprender.test.ts, lib/lectura-novato.ts, tests/lectura-novato.test.ts, lib/universos.ts, app/lab-universos.tsx, tests/universos.test.ts
- Universos de monedas (lib/universos.ts, app/lab-universos.tsx): grupos con criterio escrito de antemano (las 10 del estudio, infraestructura y DeFi, pumpeo, gemas). Regla que manda: vigilar en vivo se puede con cualquier moneda, medir en el pasado solo con las que tienen velas descargadas; un universo sin datos se marca «solo en vivo» y no muestra acierto ni profit factor. Gemas queda sin lista a propósito: armarla hoy mirando para atrás sería sesgo del sobreviviente. Las monedas de cada universo no se cambian por cómo les fue.
- Lectura para novatos (lib/lectura-novato.ts): traduce las métricas del backtest a frases en castellano y da un veredicto que mira primero la muestra, después si se sostiene fuera del tramo con el que se eligió la regla, y recién al final el signo del resultado. Nunca dice que una estrategia gana: el mejor veredicto posible es «para seguir mirando», y manda a medir hacia adelante. También ordena los gatillos de la práctica por nivel, con el control al azar primero (es el piso contra el que medirse).
- APRENDER (lib/aprender.ts, app/aprender-lab.tsx, pestaña APRENDER, primera del laboratorio): lecciones para quien recién empieza (vela, gatillo, stop y R, costos, winrate y profit factor, muestra y azar, cómo usar la práctica), preguntas con explicación y glosario. Es texto puro: no da señales, no promete ganancias y no opera.
- Práctica del gatillo (lib/practica-gatillo.ts, app/practica-gatillo.tsx, pestaña PRÁCTICA): la persona ve las velas hasta una vela y decide si la regla de un gatillo dispara ahí. La verdad usa las mismas reglas del estudio y el resultado la misma escalera; se revela solo después de contestar. La tanda tiene mitad con gatillo y mitad sin gatillo, no la frecuencia real. Practicar no mide ganancias ni opera. Cada prueba de causalidad cubre todas las estrategias del laboratorio.
Reglas:
- Estudio de estrategias (lib/estrategias.ts, scripts/investigacion/estrategias.ts): cada agente mide UNA estrategia clásica con parámetros fijos (no se optimizan: eso infla los resultados), con la escalera de la app, costos de 0,07 % por lado, entrada a la apertura siguiente y una operación por vez. El período se parte por fecha (70 % desarrollo, 30 % evaluación) y el veredicto sale solo de la evaluación: VENTAJA exige 100 operaciones o más, el intervalo del 90 % de la expectancia entero sobre cero y ganarle al agente de control (entradas al azar). lib/estudio-estrategias-datos.ts es generado: se rehace con el script, nunca a mano. El piso (app/lab-piso.tsx) solo muestra esos números. Ninguna estrategia pasa a operar sola desde acá: pasar a papel o a real lo decide la persona.
- Agente Liquidez + IFVG + Breaker (lib/smc-liquidez.ts, SMC_LIQUIDEZ): zonas FVG y OB de la temporalidad alta (4 h; diaria para series de 4 h), conocidas solo al cierre de su vela alta; gatillo = toma de liquidez + IFVG + breaker en el mismo sentido dentro de 12 velas. Configuración fijada de antemano (margen 0,5 ATR, 2 R); la búsqueda (scripts/investigacion/smc-busqueda.ts, docs/busqueda-smc.md, 96 variantes) elige solo con el desarrollo y suma al N declarado. No usa lib/order-blocks.ts ni lib/fair-value-gaps.ts: miran velas posteriores. Los filtros de contexto (perfil de volumen, Supertrend, EMAs 9/21/30/50/100, y los tres juntos en el agente SMC_TODO) solo recortan señales y se miden en la fase 3 sin elegir ninguno. Un test vigila que ninguna señal mire el futuro.
- Agente Fibonacci + Niveles clave (lib/fibonacci-niveles.ts, FIB_NIVELES): retroceso de la última pierna de impulso (pivotes de 5 velas, al menos 2 ATR, conocida al confirmarse) hacia 0,618–0,786, con TP1/TP2/TP3 en las extensiones 1, 1,272 y 1,618 y un nivel clave (máximo o mínimo del día o la semana ANTERIORES) dentro de la zona. Configuración fijada de antemano; la búsqueda (scripts/investigacion/fib-busqueda.ts, docs/busqueda-fibonacci.md, 57 variantes) elige solo con el desarrollo y suma al N declarado. No usa los detectores del gráfico (miran velas posteriores). Un test vigila que ninguna señal mire el futuro.
- Agente Fondeo (lib/fondeo.ts, app/lab-fondeo.tsx): compuerta para cuentas de fondeo (XAUUSDT y NASDAQ, con prioridad en Telegram, panel y escaneo). Reglas de la cuenta configurables dentro de topes; el riesgo de fondeo manda: baja el riesgo o bloquea según el margen diario/total, y el objetivo cumplido bloquea. No tiene estrategia ni ventaja propia: elige entre los planes de la mesa por prioridad de instrumento y R:R, sin cambiarlos. NASDAQ_SIMBOLO queda en null hasta que la persona confirme el símbolo de Binance TradFi; no se inventa. XAU y NASDAQ no tienen datos en el estudio: ningún acierto ni profit factor hasta tenerlos. No es asesoramiento financiero.
- Piso y arena (app/lab-piso.tsx, lib/lab-arena.ts, app/lab-mini-arana.tsx): el cerebro (JARVIS) al centro y un agente con su mini araña por estrategia, los que mejor rinden cerca; abajo la arena los pone a competir con barras de R por operación en la evaluación, su intervalo del 90 % y la raya del control al azar. El color sale siempre del VEREDICTO del estudio, no del signo del número: verde sólido solo VENTAJA, verde rayado CANDIDATA (no pasa la auditoría de sobreajuste), ámbar rayado sin conclusión, rojo sin ventaja. La línea al cerebro es sólida solo para el agente que corre en papel (hoy Supertrend MTF + Volumen, AGENTES_EN_PAPEL) y punteada para los que solo están medidos; el control al azar no se conecta. Con menos de 15 operaciones se dice «muestra mínima». No inventa ni anima resultados.
- Solo simulación: el laboratorio no importa ningún camino de ejecución real (lib/binance-client-signed.ts, lib/jarvis-execution.ts) ni nombra endpoints de órdenes; un test lo vigila. Operar con dinero real es otra fase, con revisión de seguridad y autorización explícita.
- Toda operación de papel pasa por lib/lab-riesgo.ts en el motor del navegador y en la API del servidor. Los límites los pone la persona dentro de topes fijos; ningún agente los cambia ni apaga la compuerta. Sin riesgo por operación conocido, no se abre.
- El estado de la araña sale de lo que corre de verdad (escaneo, backtest, conexión, errores). Sin dato de avance, el avance es indeterminado: nunca un porcentaje inventado.
- La evaluación del backtest separa DESARROLLO y EVALUACIÓN por fecha (el último 30 %, fijado antes de mirar); cada operación cae en el tramo en que se abrió. El deslizamiento es un supuesto y se dice.
- JARVIS no corona una estrategia con menos de 15 cerradas, y dice que lo pasado no garantiza el futuro. Los agentes dicen qué está implementado, qué está activo y qué falta.
- Auditoría de sobreajuste (lib/sobreajuste.ts): el estudio informa PSR y DSR por fila (contando las variantes de la tabla y las declaradas, incluidas las de fuera de la tabla, redondeadas para arriba) y Reality Check / SPA sobre el resultado diario de todas. Una VENTAJA con DSR declarado menor a 95 % o desconocido se muestra como CANDIDATA. Probar una variante nueva sobre los mismos datos suma uno al contador de ensayos.
- Preregistro del flujo (lib/preregistro-flujo.ts): los cuatro filtros de volumen taker, funding y open interest se fijaron el 14/10/2026 antes de ver esos datos y no se ajustan; un dato faltante no aprueba ni rechaza. Los datos de Binance Vision (CC BY-NC-SA 4.0) son para investigación personal: no se commitean, no se redistribuyen y no alimentan señales para terceros.

## calidad — Pruebas
Texto: node:test sobre TypeScript sin compilar. Todo cambio de lógica trae su prueba.
Archivos: tests/**
Reglas:
- Los tests de datos de mercado incluyen uno que prueba que no se mira el futuro.
- Nada de parámetros de propiedades ni enums en código que corre en tests; imports dentro de lib/ con extensión .ts.
- Una prueba no se borra ni se salta para que pase: se arregla el código.
- Lo que baja datos de la red o lleva un ritmo recibe `fetchImpl`, el reloj y `sleep` como opciones (lib/jarvis-scan-run.ts): la prueba inyecta un fetch falso (con `status`, `ok`, `headers.get` y `json`), un reloj falso y un sleep que lo adelanta, y corre en milisegundos y sin red (tests/jarvis-scan.test.ts).
- Tipos: `npx tsc --noEmit -p .` (30 s) atrapa lo que lint, pruebas y build no ven, y el CI no lo corre. El único error esperado es `vite.config.ts` → `./build/sites-vite-plugin`: es un plugin opcional que inyecta la plataforma y no está en el repo.

## app-movil — Interfaz, PWA y celular primero
Texto: la app que se ve y se usa, pensada primero para el celular (mobile first) y después tablet y escritorio.
Archivos: app/*.tsx, app/*.css, app/*.ts, public/**, lib/account-events*.ts, lib/visible-interval*.ts
Reglas:
- Celular > tablet > escritorio. Nada sale de la pantalla ni hay scroll horizontal; margen lateral de 16 px.
- Todo texto visible va en español rioplatense (vos, «comprá», decimales con coma).
- Las reglas de React: el setState de un efecto va después del primer await.
- Los tipos compartidos viven en lib/. El código de cliente nunca importa rutas de app/api/.
- Ver un componente sin levantar la app: empaquetar un archivo de entrada con esbuild (alias `@` a la raíz, los módulos de red reemplazados por stubs), armar una página con app/globals.css y el CSS del componente (hay que definir `--font-mono`) y sacarle capturas con Playwright (Chromium está en /opt/pw-browsers) a 390 y a 1100 px. Se mira que `document.documentElement.scrollWidth` sea igual al ancho de la ventana: sin desborde horizontal.
