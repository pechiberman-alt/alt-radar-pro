# Mapa de ALT RADAR PRO

> Lo escribe `npm run arana` (scripts/arana.mjs) desde el código y desde docs/araña/objetivos.md. No se edita a mano.
> Lectura estática: los imports armados en tiempo de ejecución no aparecen.
> Para no leer el repo entero: `npm run arana -- --buscar <tema>`, `--archivo <ruta>`, `--ruta <archivo>`, `--objetivo <nombre>`, `--tablas`, `--secretos`, `--cambios`, `--check`.

- Archivos: 474 · objetivos: 15 · sin objetivo: 0
- Tablas D1: 43 · secretos: 4 · variables de entorno: 8 · rutas /api: 49 · hosts: 54
- Código de navegador: 56 archivos con "use client" que alcanzan 154 · problemas: 0
- Lib sin prueba directa: 20 de 146

## Objetivos

### jarvis — JARVIS, la IA propia del software (54)
Texto: asistente de voz y análisis dentro de la app, con su núcleo 24/7 en el servidor: cascada de cerebros, memoria por persona, lectura horaria (MENTE), analista de cada activo, voz neural y manos libres.
Pendiente: Cargar la clave gratis de Groq en CONFIGURACIÓN: hace más rápida a MENTE (sin ella usa Workers AI). · Mesa: la clave gratis de CoinMarketCap es opcional (CONFIGURACIÓN); TradingView no tiene API pública de datos (solo widgets y webhooks). /api/market/derivatives?symbol=BTCUSDT dice qué exchange contestó.
- `app/api/analyst/ai/route.ts` — exporta: dynamic, POST
- `app/api/jarvis/alert/route.ts` — exporta: dynamic, POST
- `app/api/jarvis/chat/route.ts` — exporta: dynamic, GET, POST, DELETE
- `app/api/jarvis/core/route.ts` — exporta: dynamic, GET
- `app/api/jarvis/memory/route.ts` — exporta: dynamic, GET, POST, DELETE
- `app/api/jarvis/paper/route.ts` — exporta: dynamic, GET, POST, PUT
- `app/api/jarvis/voice/route.ts` — exporta: dynamic, GET, POST
- `app/api/telegram/webhook/route.ts` — exporta: dynamic, POST
- `app/assistant-console.tsx` — exporta: AssistantConsole, default
- `app/jarvis-backtest.tsx` — exporta: BacktestBlock
- `app/jarvis-paper.tsx` — exporta: usePaper, PaperFollow, PaperBlock
- `app/jarvis-trading.css` — JARVIS TRADING — la mesa de especialistas.
- `app/jarvis-trading.tsx` — exporta: JarvisTrading, default
- `app/jarvis-voice-player.ts` — Plays JARVIS's neural voice (app/api/jarvis/voice) fluidly: the reply is cut into sentences, the first two are requested at once and each next one while the current plays, so after
- `app/jarvis-watch.tsx` — exporta: JarvisWatcher, WatchBlock
- `app/jarvis.css` — JARVIS — HUD voice assistant
- `app/jarvis.tsx` — exporta: Jarvis, default
- `lib/ai-analyst-server.ts` — exporta: quotaFor, consumeQuota, alternate, askClaude
- `lib/ai-analyst.ts` — exporta: AI_MODEL, AI_DAILY_LIMIT, AI_MAX_OUTPUT, compactSnapshot, buildSystemPrompt, buildUserMessage (+4)
- `lib/ai-brains.ts` — exporta: Brain, BRAIN_LABEL, Usage, BrainResult, AiLike, WORKERS_MODEL (+23)
- `lib/ai-cascade.ts` — exporta: CascadeOk, CascadeFail, answerWithBrains
- `lib/ai-numbers.ts` — Numbers for the AIs, already written the Argentine way ("82.920", "11,066", "0,7042", "-2,99").
- `lib/ai-probe.ts` — exporta: PROBE_SCHEMA, Probe, readProbe, probeFreeBrain, resetProbe
- `lib/assistant/index.ts` — exporta: AssistantContext, AssistantAnswer, extractSymbol, ask
- `lib/assistant/knowledge.ts` — Curated explanations for the concepts the terminal actually uses.
- `lib/browser-voice.ts` — Picks the best Spanish voice the browser has.
- `lib/hands-free.ts` — Manos libres: the rules behind JARVIS's listening mode in the browser.
- `lib/jarvis-analyst.ts` — exporta: Frames, Scenario, Analysis, analyzeAsset, analysisText, analysisForAi
- `lib/jarvis-backtest-run.ts` — exporta: BACKTEST_EVENT, BACKTEST_DAYS, BacktestProgress, BacktestOutcome, lastBacktest, historyOf (+1)
- `lib/jarvis-backtest.ts` — exporta: BACKTEST_STEP_H, WARMUP_H1, BacktestInput, BacktestMetrics, BacktestResult, BACKTEST_LIMITS (+11)
- `lib/jarvis-chat.ts` — The conversation with JARVIS in the app, kept for each signed-in person, so a reload does not lose the thread.
- `lib/jarvis-core-db.ts` — exporta: ensureCoreSchema, rowToSignal, readCoreStats, recordCoreSignals, openCoreSignals, isBusy (+12)
- `lib/jarvis-core.ts` — exporta: CORE_TF, CORE_FRAME, CORE_COINS, CORE_MAGNETS, CYCLE_MIN, CoreTask (+36)
- `lib/jarvis-desk-agents.ts` — exporta: AgentId, AgentReport, NOT_AVAILABLE, AGENT_WEIGHTS, pct, px (+19)
- `lib/jarvis-desk-data.ts` — exporta: DESK_FRAMES, Derivatives, MacroData, DeskSnapshot, DeskProvider, DESK_PROVIDERS (+3)
- `lib/jarvis-desk-run.ts` — exporta: DESK_SETTINGS_KEY, DESK_SHOW_EVENT, typedNumber, loadDeskSettings, saveDeskSettings, openPaperRiskUsd (+3)
- `lib/jarvis-desk.ts` — exporta: Side, Direction, Target, Plan, DeskSettings, MAX_OPEN_RISK_PCT (+30)
- `lib/jarvis-execution.ts` — exporta: DeskMode, DESK_MODES, REAL_ORDERS_FROM_JARVIS, TICKET_TTL_MS, TICKET_MAX_AGE_MS, MAX_TICKET_RISK_PCT (+3)
- `lib/jarvis-learn.ts` — exporta: Regime, Features, DIMS, D, ALPHA, MIN_CASES (+37)
- `lib/jarvis-ledger.ts` — exporta: HORIZON, FEE_PCT, LearnedSource, JarvisSource, JarvisSignal, breakoutSignal (+7)
- `lib/jarvis-local.ts` — exporta: Focus, pointsAtScreen, SCREEN_TOPIC, SECTION_SCREEN, withFocus, localAnswer
- `lib/jarvis-memory.ts` — What a person asked JARVIS to remember ("Jarvis, recordá que opero solo BTC y SOL").
- `lib/jarvis-mind-db.ts` — exporta: MIND_MINUTE, MindDeps, runMindHour, mindStatus
- `lib/jarvis-mind.ts` — exporta: MindThesis, MindReading, MIND_MAX_THESES, MIND_MAX_OUTPUT, MIND_SYSTEM, thesisRecord (+14)
- `lib/jarvis-paper-db.ts` — exporta: MAX_OPEN_PER_USER, MAX_TOTAL_PER_USER, LIST_LIMIT, ensurePaperSchema, listPaper, paperCounts (+5)
- `lib/jarvis-paper-run.ts` — exporta: PAPER_LOCAL_KEY, PAPER_EVENT, PaperMode, paperState, paperTrades, lastPrice (+7)
- `lib/jarvis-paper.ts` — exporta: PAPER_HORIZON_H, LIMIT_EXPIRY_H, MINUTE, PaperState, ExitKind, PaperExit (+27)
- `lib/jarvis-voice-server.ts` — exporta: AiLike, VoiceModel, Bytes, Synth, AURA, MELO (+11)
- `lib/jarvis-voice.ts` — JARVIS's neural voice, shared by the server route and the app.
- `lib/jarvis-watch-run.ts` — exporta: WATCH_PREFS_KEY, WATCH_STATE_KEY, WATCH_EVENT, WatchStatus, loadWatchPrefs, saveWatchPrefs (+3)
- `lib/jarvis-watch.ts` — exporta: WatchKind, WATCH_KINDS, WatchPrefs, DEFAULT_WATCH_PREFS, MAX_WATCHED, CENTER_VOLUME (+6)
- `lib/jarvis-world.ts` — exporta: WorldNews, World, worldDigest, readWorld, saveWorld
- `lib/jarvis.ts` — JARVIS: the app's voice assistant.
- `lib/speech-text.ts` — What JARVIS writes, turned into what a Spanish voice should say.

### honestidad — Nunca inventar: probabilidades, precios, noticias (0)
Texto: transversal a todo el producto. Lo que no se sabe se dice, no se estima a escondidas.

### senales-radar — Radar de señales, a punto de romper, imanes y estructura (67)
Texto: lo que el software detecta en el mercado: señales, presión antes de romper, zonas de liquidación, estructura y niveles.
Pendiente: Alertas de volumen siguen silenciosas desde el 30/09: Binance solo. Falta la decisión de Uri (Coinbase/Kraken con aviso).
- `app/api/backtest/fibonacci/route.ts` — exporta: dynamic, GET
- `app/api/brain/route.ts` — exporta: dynamic, ensureBrainSchema, POST
- `app/api/liquidity-history/route.ts` — exporta: dynamic, GET, POST
- `app/api/radar/route.ts` — exporta: dynamic, GET
- `app/api/scalping/route.ts` — exporta: dynamic, POST
- `app/api/signals/route.ts` — exporta: dynamic, GET, POST
- `app/futures-desk.tsx` — exporta: FuturesDesk, default
- `app/liquidation-heatmap-desk.tsx` — exporta: LiquidationHeatmapDesk, default
- `app/market-brain.tsx` — exporta: MarketBrain, default
- `app/prebreak-desk.tsx` — exporta: PreBreakDesk, default
- `app/pump-radar.tsx` — exporta: PumpRadar, default
- `app/radar-app.tsx` — exporta: RadarApp, default
- `app/scalping-desk.tsx` — exporta: ScalpingDesk, default
- `lib/asset-read.ts` — exporta: Trend, TfRead, Level, AssetRead, ema, aggregate (+5)
- `lib/automation.ts` — exporta: AutomationResult, ensureSignalSchema, loadMarket, loadRiskScore, loadBtcDominance, evaluateOpenSignals (+3)
- `lib/big-trades.ts` — Large executed trades: who is actually hitting the book with size.
- `lib/brain-security.ts` — exporta: BRAIN_MODEL_VERSION, BrainSecurityState, unavailableBrainSecurity, ensureBrainSecuritySchema, appendBrainAuditEvent, registerBrainManifest (+1)
- `lib/chart-patterns.ts` — exporta: FlagPattern, findFlags, WyckoffEvent, WyckoffReading, readWyckoff
- `lib/decoupling.ts` — "Suben solas": coins rising on their own while BTC and ETH don't.
- `lib/fair-value-gaps.ts` — exporta: GapKind, FairValueGap, GapOptions, findFairValueGaps, ZoneStats, GapStats (+1)
- `lib/fib-backtest.ts` — exporta: FIB_LEVELS, FibLevel, FibSide, FibTradeOutcome, FibOutcome, runFibBacktest (+2)
- `lib/fib-zone.ts` — exporta: FibZoneState, readFibZone
- `lib/footprint.ts` — Order-flow for the map: candle delta, CVD and footprint cells.
- `lib/inducement.ts` — exporta: IdmSide, IdmOutcome, Inducement, IdmOptions, findInducements, IdmStats (+1)
- `lib/institutional-flows.ts` — US spot Bitcoin ETF flows, read as a demand regime.
- `lib/key-levels.ts` — exporta: KeyLevel, KeyLevelOptions, keyLevels
- `lib/level-engine.ts` — exporta: LevelSource, Level, atrOf, structureSources, referenceSources, volumeProfile (+7)
- `lib/liq-vol-signals.ts` — exporta: LvSide, LvSignal, LvOptions, FlushSeries, flushRatioAt, findLvSignals (+6)
- `lib/liquidation-columns.ts` — exporta: LiquidationLife, LivesOptions, buildLiquidationLives, GridOptions, LiquidationGrid, liquidationGrid (+1)
- `lib/liquidation-heatmap.ts` — exporta: MAJOR_LEVERAGE_TIERS, DEFAULT_LEVERAGE_TIERS, leverageTiersFor, TIER1_MAINTENANCE_MARGIN_RATE, maintenanceMarginRateFor, TierShare (+9)
- `lib/liquidity-archive.ts` — exporta: archiveCoreLiquidity
- `lib/liquidity-history.ts` — exporta: LiquidityLevel, LiquiditySnapshot, ensureLiquiditySchema, validateLevels, readLiquidityHistory, storeLiquiditySnapshot
- `lib/liquidity-pools.ts` — exporta: PoolSide, LiquidityPool, PoolOptions, findLiquidityPools, MtfPool, mergeMtfPools
- `lib/liquidity-sweeps.ts` — exporta: Sweep, findSweeps, SweepStats, sweepStats
- `lib/magnet-watch.ts` — exporta: Magnet, MagnetPair, strongestMagnets, atrPct, MagnetEvent, MagnetEventOptions (+4)
- `lib/market-structure.ts` — Global market structure: total capitalisation and dominance.
- `lib/mtf-zones.ts` — exporta: MtfZone, MtfZoneBoard, buildMtfZones
- `lib/order-blocks.ts` — exporta: OrderBlock, OrderBlockOptions, findOrderBlocks, ZoneStats, orderBlockStats, BreakerBlock (+2)
- `lib/order-flow-brain.ts` — Explicit extension so Node can run this directly in the unit tests; the bundler resolves it the same way.
- `lib/order-flow.ts` — Pure order-flow analysis, extracted from the bookmap component so it can be exercised without mounting a WebSocket-driven canvas.
- `lib/oscillators.ts` — exporta: rsi, ema, Macd, macd, Divergence, DivergenceOptions (+5)
- `lib/pre-breakout.ts` — exporta: PreBreakSide, PreBreak, readPreBreak, PreBreakReplay, replayPreBreakout, preBreakKey (+3)
- `lib/pump-plan.ts` — exporta: PumpAction, PumpPlan, pumpPlan
- `lib/pump-pressure.ts` — exporta: PressureFactors, PressureReading, PressureInput, readPressure, rankPressure
- `lib/pump-radar.ts` — exporta: PumpCandle, PumpStage, PumpMetrics, PumpReading, PumpCandidate, screenPumpCandidates (+2)
- `lib/radar.ts` — exporta: MarketAsset, NewsEvent, RadarPayload, ScoreConfig, ScoreReason, ScoredAsset (+7)
- `lib/reversal-zones.ts` — Best reversal zones: where several independent detectors agree.
- `lib/scalp-signals.ts` — exporta: ScalpSignal, ScalpOptions, findScalpSignals, ScalpStats, scalpStats
- `lib/scalping-automation.ts` — exporta: ScalpingAutomationResult, runScalpingAutomation
- `lib/scalping-engine.ts` — exporta: ScalpStatus, ScalpSignal, ScalpContext, buildScalpSignal
- `lib/scenario-analysis.ts` — exporta: ScenarioLevel, Scenario, ScenarioBoard, buildScenarios
- `lib/signal-confluence.ts` — exporta: SignalTargets, buildSignalTargets, ProximityAlert, proximityAlert
- `lib/signal-ledger.ts` — exporta: SignalOutcome, SignalPlanView, SignalRecord, LedgerStats, LedgerPayload
- `lib/signal-plan-db.ts` — exporta: PLAN_COLUMNS, resetPlanColumnsCache, ensureSignalPlanColumns, attachPlan, evaluateSignalPlans, STATS_DAYS (+4)
- `lib/signal-plan-record.ts` — exporta: recordConfluencePlan, recordScalpPlan, evaluatePlansSafely
- `lib/signal-plan.ts` — exporta: PlanSide, SignalPlan, PlanOutcome, PLAN_EXPIRY_MS, ATR_PERIOD, SWING_CANDLES (+18)
- `lib/spot-plan-client.ts` — Client-side data assembly for a spot plan: candles from Binance mirrors, MTF zones, the Fibonacci band, trend, and locked-supply overhang — the same inputs app/spot-desk.tsx has al
- `lib/spot-strategy.ts` — Spot buying strategy: a fixed plan plus a live checklist and ladders.
- `lib/squeeze.ts` — Squeeze conditions: which side is trapped, and what it would cost to hold.
- `lib/structure-archive.ts` — exporta: StructurePoint, StructureTrend, ensureStructureSchema, recordStructureSnapshot, seriesChange, loadStructureTrend
- `lib/supply-demand.ts` — exporta: ZoneKind, ZoneState, SupplyDemandZone, ZoneStats, ZoneOptions, detectZones (+2)
- `lib/swing-entries.ts` — Swing entry detection.
- `lib/swing-liquidity-filter.ts` — exporta: StopAdjustment, adjustStopForLiquidity
- `lib/trade-bubbles.ts` — exporta: Bubble, BubbleOptions, DEFAULT_MAX_BUBBLES, DEFAULT_TOP_SHARE, pickBubbles, bubbleRadius (+1)
- `lib/trading-profiles.ts` — exporta: ProfileId, Horizon, TradingProfile, TRADING_PROFILES, PROFILE_ORDER, RiskInput (+2)
- `lib/trendlines.ts` — exporta: Pivot, LineSide, Trendline, Outcome, TrendBreak, RangeBreak (+8)
- `lib/volume-spike.ts` — exporta: VOLUME_LOOKBACK, VOLUME_THRESHOLD, VolumeSpike, detectVolumeSpike, dec, dollars (+2)

### datos-mercado — Velas, precios, noticias y frescura (29)
Texto: de dónde vienen los precios, velas, noticias y flujos, y cuánto pueden tardar. Siempre se dice la fuente.
- `app/api/calendar/route.ts` — exporta: dynamic, GET
- `app/api/etf-flows/route.ts` — exporta: dynamic, GET
- `app/api/exchange-flows/route.ts` — exporta: dynamic, GET
- `app/api/institutional/route.ts` — exporta: dynamic, GET
- `app/api/klines/route.ts` — exporta: dynamic, POST, GET
- `app/api/market-structure/route.ts` — exporta: dynamic, POST, GET
- `app/api/market/derivatives/route.ts` — exporta: dynamic, GET
- `app/api/orderbook/route.ts` — exporta: dynamic, GET
- `app/api/rolling/route.ts` — exporta: dynamic, GET
- `app/api/sentiment/route.ts` — exporta: dynamic, GET
- `app/api/structure-trend/route.ts` — exporta: dynamic, GET
- `app/api/tickers/route.ts` — exporta: dynamic, normalizeTickers, GET
- `app/binance-klines.ts` — Shared candle loader for the browser-side panels.
- `lib/crypto-news.ts` — exporta: CRYPTO_FEEDS, NewsCategory, CryptoNewsItem, classifyCryptoNews, dedupeNews, CryptoNewsResult (+1)
- `lib/econ-calendar.ts` — Macro calendar (Forex Factory) and the trading blackouts built from it.
- `lib/etf-flows-multi.ts` — Institutional ETF flows across assets: which coin the funds are actually putting money into, side by side.
- `lib/exchange-reserves.ts` — Exchange reserves, read as accumulation or distribution.
- `lib/fear-greed.ts` — Crypto Fear & Greed index (alternative.me), summarized.
- `lib/klines-history.ts` — exporta: BACKTEST_INTERVALS, fetchHistoricalCandles
- `lib/klines-server.ts` — exporta: GLOBAL_BASES, THIN_BASES, FUTURES_BASES_SERVER, KRAKEN_BASE, COINBASE_BASE, FUTURES_ONLY (+12)
- `lib/live-feed.ts` — exporta: FeedSource, FeedState, FeedStatus, FeedDeps, FEED_TIMING, startLiveFeed (+1)
- `lib/live-market.ts` — Live feed for the liquidation map: the forming candle and REAL liquidations.
- `lib/market-brain.ts` — exporta: BRAIN_TIMEFRAMES, BrainTimeframe, MarketBias, MarketVenue, TIMEFRAME_MINUTES, Candle (+12)
- `lib/market-fetch.ts` — Browser-side market fetchers, shared by the panels that need them.
- `lib/market-providers.ts` — exporta: ProviderId, Fetcher, Attempt, PROVIDER_LABEL, BINANCE_FUTURES, BYBIT (+18)
- `lib/news-intelligence.ts` — exporta: RawNewsItem, NewsIntelligenceResult, parseRss, classifyNewsItems, loadGlobalNews
- `lib/shared-cache.ts` — Shared, short-lived cache for database-backed JSON that is the same for everyone (signal ledger, performance totals).
- `lib/token-unlocks.ts` — Supply overhang: how much of each token still has to reach the market.
- `lib/upstream-cache.ts` — Shared in-Worker cache for upstream market data.

### binance-usuario — Cuenta de Binance del usuario (12)
Texto: lectura de la cuenta y operaciones con claves del usuario, siempre desde su navegador.
- `app/api/binance/client-log/route.ts` — exporta: dynamic, POST
- `app/api/binance/credentials/route.ts` — exporta: dynamic, GET
- `app/api/binance/futures-log/route.ts` — exporta: dynamic, GET, POST
- `app/api/binance/link/route.ts` — exporta: dynamic, POST, DELETE
- `lib/binance-account.ts` — Per-client Binance spot account linking.
- `lib/binance-client-signed.ts` — Signed Binance calls made FROM THE BROWSER, over Binance's WebSocket API.
- `lib/binance-debug-log.ts` — exporta: logBinanceFailure
- `lib/binance-futures.ts` — Per-client Binance USDⓈ-M futures reading, using the same linked credentials and the same signed-request machinery as spot (lib/binance-account.ts) — this module adds no new signin
- `lib/binance-import.ts` — exporta: parseCsv, parseQuantity, parseTime, parseSide, ImportResult, parseBinanceCsv (+2)
- `lib/binance-ws.ts` — Binance USDⓈ-M futures WebSocket routing — one place for it.
- `lib/futures-log-db.ts` — exporta: MAX_FUTURES_LOG_ROWS, ensureFuturesLogSchema, listFuturesLog, countFuturesLog, saveFuturesLog
- `lib/futures-log.ts` — The record of the person's REAL Binance USDⓈ-M futures activity.

### telegram — Bot: alertas 24/7, comandos y chat con JARVIS (14)
Texto: el canal que trabaja con la app cerrada: manda alertas, responde preguntas y comandos, y recibe notas de voz.
Pendiente: Notas de voz: con Groq si está la clave; si no, Whisper de Workers AI dentro del cupo gratis diario.
- `app/api/telegram/link/route.ts` — exporta: dynamic, GET, POST, PUT, DELETE
- `app/api/telegram/test/route.ts` — exporta: dynamic, POST
- `app/telegram-card.tsx` — exporta: TelegramCard, default
- `lib/price-alerts-server.ts` — exporta: PRICE_ALERTS_SCHEMA, ensurePriceAlertsSchema, listUserAlerts, fetchSpotPrice, CreateResult, createPriceAlert (+2)
- `lib/price-alerts.ts` — exporta: AlertDirection, PriceAlert, MAX_ALERTS_PER_USER, LOOKBACK_MINUTES, MIN_DISTANCE, normalizeSymbol (+9)
- `lib/telegram-ai-server.ts` — exporta: loadServerSnapshot, clearChat, answerInTelegram, answerVoiceInTelegram
- `lib/telegram-ai.ts` — Telegram answers from the ALT RADAR analyst: the pure parts.
- `lib/telegram-dispatch.ts` — exporta: runTelegramDispatch
- `lib/telegram-jarvis.ts` — exporta: recordLine, gradeLine, jarvisEvents, readingEvent, dailyEvent, collectJarvisEvents
- `lib/telegram-magnets.ts` — exporta: MAGNET_WATCH, magnetEventsFromMind, collectMagnetEvents
- `lib/telegram-server.ts` — exporta: ensureTelegramSchema, botUsername, ensureWebhook
- `lib/telegram-voice.ts` — JARVIS on Telegram by voice.
- `lib/telegram-volume.ts` — exporta: VOLUME_WATCH, VOLUME_FRAMES, framesFor, volumeEventsFrom, collectVolumeEvents
- `lib/telegram.ts` — Telegram alerts: the pure parts.

### alertas — Avisos de la app: push del navegador y centro de alertas (8)
Texto: lo que llega al navegador o al celular cuando algo pasa.
- `app/alert-center.tsx` — exporta: AlertCenter, default
- `app/alert-toasts.tsx` — exporta: AlertToasts, default
- `app/api/alerts/latest/route.ts` — exporta: dynamic, GET
- `app/api/alerts/prebreak/route.ts` — exporta: dynamic, POST
- `app/api/push/subscribe/route.ts` — exporta: dynamic, POST, DELETE
- `lib/alert-bus.ts` — exporta: subscribeToAlerts, publishAlert, resetAlertBus
- `lib/alerts.ts` — One alert engine for every panel.
- `lib/web-push.ts` — Web Push: notifications that arrive with the app closed.

### riesgo-diario — Riesgo, diario de operaciones, DCA y costo promedio (22)
Texto: calculadoras y registros de la persona: cuánto arriesga, qué compró, a qué precio y cómo le fue.
- `app/api/bot/journal/route.ts` — exporta: dynamic, GET, POST
- `app/api/dca/route.ts` — exporta: dynamic, GET, POST, DELETE
- `app/api/dca/schedule/route.ts` — exporta: dynamic, GET, POST, DELETE
- `app/api/diario/fills/route.ts` — exporta: dynamic, GET, POST
- `app/api/diario/notes/route.ts` — exporta: dynamic, GET, PUT
- `app/api/journal/route.ts` — exporta: dynamic, GET, POST, DELETE
- `app/api/performance/route.ts` — exporta: dynamic, GET
- `app/dca-desk.tsx` — exporta: DcaDesk, default
- `app/diario-desk.tsx` — exporta: DiarioDesk, default, DEFAULT_SETTINGS
- `app/diario-tools.tsx` — exporta: CalculatorView, DataView
- `app/diario-views.tsx` — exporta: NoteMap, EquityChart, SummaryView, TradesView
- `app/risk-desk.tsx` — exporta: RiskDesk, default
- `app/trade-journal-desk.tsx` — exporta: TradeJournalDesk, default
- `lib/account-journal.ts` — exporta: Market, FillSource, JFill, JFunding, DOLLARS, splitSymbol (+25)
- `lib/bot-journal-db.ts` — exporta: ensureBotJournalSchema, listBotJournal, countBotJournal, saveBotJournal, journalKey, MAX_ROWS_PER_USER
- `lib/bot-journal.ts` — exporta: JournalStatus, JournalRow, journalKey, journalRowFrom, validateJournalRow, mergeJournal (+5)
- `lib/cost-basis.ts` — Weighted-average cost basis and the risk numbers built on top of it, for a spot portfolio pulled from Binance.
- `lib/dca-tracker.ts` — A record of DCA purchases the person made themselves, and the arithmetic that turns it into a position.
- `lib/diario-db.ts` — exporta: MAX_JOURNAL_FILLS, MAX_JOURNAL_NOTES, TRADE_KEY, ensureDiarioSchema, listJournalFills, countJournalFills (+3)
- `lib/futures-risk.ts` — Pure math over one raw Binance futures position: side, ROE, distance to liquidation, and how much of that position's loss is actually capped.
- `lib/risk-calc.ts` — Position-size and risk calculator.
- `lib/trade-journal.ts` — A manual trade journal, and the win-rate math it feeds.

### robots-papel — Robots y bots de papel (simulación) (5)
Texto: operaciones simuladas para medir ideas. No mueven dinero real.
- `app/api/robot/signal/route.ts` — exporta: dynamic, POST
- `app/robot-signals-desk.tsx` — exporta: RobotSignalsDesk, default
- `lib/mm-robot.ts` — exporta: LiveLevel, MmEvent, liquidityAt, mmEvents, MmFilter, MmTrade (+12)
- `lib/paper-bot.ts` — exporta: BotCandle, BotConfig, DEFAULT_BOT_CONFIG, TradeStatus, PaperTrade, Skips (+8)
- `lib/robot-signals.ts` — exporta: MM_WIDE_KEY, MM_WIDE_TTL, ROBOT_FRAMES, WideVariant, WideSummary, liveRobotTrade (+4)

### d1-presupuesto — Base D1 y presupuesto gratis (0)
Texto: transversal. Plan gratuito: 5 millones de filas leídas por día, ya superado más de una vez.

### despliegue — Worker, CI y migraciones (36)
Texto: cómo llega el código a producción, cómo corre en el Worker y la configuración del proyecto.
- `.github/workflows/claude.yml`
- `.github/workflows/deploy-cloudflare.yml`
- `.gitignore`
- `.openai/hosting.json`
- `README.md` — ALT RADAR PRO
- `THIRD_PARTY_NOTICES.md` — Third-party notices
- `app/api/version/route.ts` — exporta: dynamic, GET
- `db/index.ts` — exporta: getDb
- `db/schema.ts` — exporta: signalRecords, automationState, brainObservations, brainSecurityEvents, users, sessions (+2)
- `drizzle.config.ts` — exporta: default
- `drizzle/0000_wild_nitro.sql`
- `drizzle/0001_vengeful_husk.sql`
- `drizzle/0002_slimy_kingpin.sql`
- `drizzle/0003_reflective_lady_vermin.sql`
- `drizzle/0004_cultured_korath.sql`
- `drizzle/0005_abnormal_vin_gonzales.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/0001_snapshot.json`
- `drizzle/meta/0002_snapshot.json`
- `drizzle/meta/0003_snapshot.json`
- `drizzle/meta/0004_snapshot.json`
- `drizzle/meta/0005_snapshot.json`
- `drizzle/meta/_journal.json`
- `eslint.config.mjs` — exporta: default
- `examples/d1/app/api/notes/route.ts` — exporta: GET, POST
- `examples/d1/db/schema.ts` — exporta: notes
- `lib/app-settings.ts` — exporta: SETTINGS_SCHEMA, SecretName, SettingsEnv, SecretSource, Packed, packSecret (+11)
- `next-env.d.ts`
- `next.config.ts` — exporta: default
- `package.json`
- `postcss.config.mjs` — exporta: default
- `scripts/write-build-info.mjs` — Stamps every build with an id both the client bundle and the server share, so an app instance can tell it is running old code.
- `tsconfig.json`
- `vite.config.ts` — exporta: default
- `worker/index.ts` — Cloudflare Worker entry point for the vinext-starter template.
- `wrangler.production.jsonc`

### seguridad — Sesiones, secretos y claves (8)
Texto: quién entra, cómo se guardan los secretos y qué nunca sale del servidor.
Pendiente: Borrar en Cloudflare el token «Altradar 2» y rotar los tokens que quedaron a la vista en el chat.
- `app/api/admin/settings/route.ts` — exporta: dynamic, GET, POST, PUT, DELETE
- `app/api/auth/login/route.ts` — exporta: dynamic, POST
- `app/api/auth/logout/route.ts` — exporta: dynamic, POST
- `app/api/auth/me/route.ts` — exporta: dynamic, GET
- `app/api/auth/register/route.ts` — exporta: dynamic, POST
- `app/sign-in-prompt.tsx` — exporta: SignInPrompt, default
- `lib/auth.ts` — Per-client authentication: email + password, isolated by user_id.
- `lib/secret-box.ts` — AES-GCM with a base64 32-byte key: iv (12 bytes) + ciphertext, base64.

### araña — La araña del proyecto y las instrucciones para trabajar en él (5)
Texto: el mapa del proyecto que se consulta sin gastar tokens: qué hace cada archivo, de quién depende y qué objetivo cumple.
- `CLAUDE.md` — ALT RADAR PRO — reglas del proyecto
- `docs/araña/objetivos.md` — Objetivos de ALT RADAR PRO
- `scripts/arana-vista.html`
- `scripts/arana.mjs` — exporta: ROOT, DOCS, OBJETIVOS, MAPA, HUELLAS, norm (+42)
- `tests/arana.test.ts` — pruebas: the objectives file gives its synonyms and its objectives, transversal ones incl, an objective without Texto or Archivos is a mistake, not a silent gap, globs: * stays inside one folder, ** goes through all of them (+1)

### calidad — Pruebas (119)
Texto: node:test sobre TypeScript sin compilar. Todo cambio de lógica trae su prueba.
- `tests/account-journal.test.ts` — pruebas: a long: entry, exit, size, result and fees, Binance, a short mirrors a long (+1)
- `tests/ai-analyst.test.ts` — pruebas: the snapshot keeps only the strongest signals and the majors, bounded, numbers are rounded, not dropped, the instructions forbid invented numbers and orders, and carry the app (+1)
- `tests/ai-brains.test.ts` — pruebas: answers are read in every shape these APIs use, without the model, Cloudflare, the free brain on Workers AI: Qwen3 without thinking out loud; spent allowance a (+1)
- `tests/ai-numbers.test.ts` — pruebas: numbers reach the AIs already written the Argentine way, forAi converts every number but times, and leaves the rest alone, a level written back is read in either notation, the one near the price winning
- `tests/alert-bus.test.ts` — pruebas: a published alert reaches every subscriber, the same condition is not raised twice, unsubscribing actually stops delivery (+1)
- `tests/alerts.test.ts` — pruebas: nothing is delivered while alerts are off, the same condition does not re-fire on every refresh, priority floor keeps the quiet tier out of notifications (+1)
- `tests/api-routes.test.ts` — pruebas: every proxy route refuses to cache upstream failures as success, no route sends a no-store response as cacheable, klines validates symbol and interval before reaching upstream (+1)
- `tests/app-settings.test.ts` — pruebas: a generated key is 32 bytes of base64 and usable for AES-GCM, a value encrypted with one key does not open with another, stored values remember which key encrypted them (+1)
- `tests/asset-read.test.ts` — pruebas: 4h and daily candles are built from complete groups of 1h candles, aligned to UT, trend by timeframe: a steady climb is alcista, a slide bajista, a wave de costad, supports and resistances are swing points on 4h, nearest first, merged when clos (+1)
- `tests/assistant.test.ts` — pruebas: reports institutional patterns from the live order flow, answers where the strongest floor is, with its confluence, answers the side that was asked about first (+1)
- `tests/auth-pbkdf2.test.ts` — pruebas: PBKDF2 stays within the Cloudflare Workers ceiling, a hashed password verifies, and a wrong one does not
- `tests/big-trades.test.ts` — pruebas: aggressor side comes from the maker flag, not from volume, malformed rows are dropped rather than defaulted, trades come back oldest first regardless of feed order (+1)
- `tests/binance-account.test.ts` — pruebas: a Binance credential round-trips through encrypt/decrypt with no Cloudflare secr, linking never throws ENCRYPTION_KEY_MISSING: it always resolves a key, Cloudflar, a stored credential still decrypts after a Cloudflare secret is later added (+1)
- `tests/binance-client-signed.test.ts` — pruebas: HMAC matches the test vector Binance publishes in its own API docs, signParams sorts by name, joins without encoding, ignores any signature already , a spot read goes to the spot endpoint, correctly signed, and the secret never le (+1)
- `tests/binance-debug-log.test.ts` — pruebas: logs a BinanceApiError with its status and message, logs a plain Error with a null status, a very long message is truncated so the row stays bounded (+1)
- `tests/binance-import.test.ts` — pruebas: the futures export layout: columns found by name, rows become fills, numbers carry their asset, pairs come in several spellings, columns in Spanish, semicolon files read the comma as a decimal (+1)
- `tests/binance-ws.test.ts` — pruebas: candles, trades, tickers and liquidations route to /market, order-book streams route to /public, the URL uses the routed path, never the retired root (+1)
- `tests/bot-journal.test.ts` — pruebas: a closed trade becomes a row carrying everything the report needs; an open one d, the key includes the account start: the same trade id after a reset is a differe, merge keeps one row per key — the first source wins — sorted by close time (+1)
- `tests/breaker-blocks.test.ts` — pruebas: an order block that never breaks produces no breaker block and no stat, a break with no retest is an active, unproven breaker block, a break that gets retested and holds counts as held, and stays active (+1)
- `tests/chart-patterns.test.ts` — pruebas: a pole and a tight pause form a bull flag, forming until it breaks, a close above the flag confirms it, one below fails it, the mirror image is a bear flag (+1)
- `tests/cost-basis.test.ts` — pruebas: a single buy sets the average cost to its own price, two buys at different prices give the size-weighted average, a sell removes units at the current average and leaves the average unchanged (+1)
- `tests/dca-tracker.test.ts` — pruebas: average cost is total invested over total units, not a plain price average, P&L is null until a current price is supplied — not zero, with a current price, P&L compares current value to what was actually invested (+1)
- `tests/decoupling.test.ts` — pruebas: a coin up 3% in 4 hours on volume while BTC and ETH sit flat rises on its own, when BTC itself is up, rising with it is not rising alone, beta comes from the hours before the window: a high-beta coin (+1)
- `tests/diario-db.test.ts` — pruebas: fills are stored once, per user, listed oldest first, and counted without scanni, a note is replaced on save, kept per user, and new ones are counted against the , trade keys are strictly shaped
- `tests/econ-calendar.test.ts` — pruebas: parses the feed: offsets become UTC, holidays and malformed rows are dropped, anything that isn, only the currencies and impacts asked for create blackouts — USD high by default (+1)
- `tests/etf-flows-multi.test.ts` — pruebas: cells parse millions, parentheses as negatives, and dashes as no data, only dated rows are read; header and summary rows are skipped, rows come back oldest first regardless of page order (+1)
- `tests/exchange-reserves.test.ts` — pruebas: median handles both odd and even counts, parseVenues keeps only exchanges with real reserves, a market-wide drop is not reported as coins leaving (+1)
- `tests/fair-value-gaps.test.ts` — pruebas: a bullish gap is found between the first and third candle, the mirror case produces a bearish gap, overlapping candles leave no gap at all (+1)
- `tests/fib-backtest.test.ts` — pruebas: finds no legs on a flat series, LONG: a clean pullback into 0.618 that continues to the extreme is a TARGET win, LONG: a pullback that breaks the leg origin before reclaiming it is a STOP loss (+1)
- `tests/fib-zone.test.ts` — pruebas: levels come from the shared FIB_LEVELS, not a private copy, a pullback inside the band is reported as in-zone, a shallow pullback is reported as not there yet (+1)
- `tests/footprint-signals.test.ts` — pruebas: no imbalanced cells at all → no stacks, two consecutive imbalanced levels is below the default minimum of 3, exactly 3 consecutive same-direction imbalances qualifies (+1)
- `tests/footprint-sweeps.test.ts` — pruebas: candle delta splits volume by aggressor from the taker-buy field, CVD accumulates and carries across gaps, bucket size is round and gives about ten rows (+1)
- `tests/footprint-verdict.test.ts` — pruebas: fewer than 3 candles with taker data → no verdict, rather than one built on noth, candles without taker data or without volume are ignored, not counted as balance, aggressive buyers winning is reported as such, with the share and the delta (+1)
- `tests/futures-log.test.ts` — pruebas: an execution becomes a fill with everything the report needs, new orders, cancels, expiries and amendments are not operations, liquidations are recorded and flagged, whether Binance marks them by execution t (+1)
- `tests/futures-risk.test.ts` — pruebas: a positive positionAmt is LONG, negative is SHORT, qty is always positive, matches Binance, liquidationPrice of 0 is read as null, never as a real price of $0 (+1)
- `tests/hands-free.test.ts` — pruebas: the wake word is found in any spelling the engine tends to produce, and the rest, a result the engine delivers again is heard once, however often it comes back, the same words coming back under a new index within a few seconds are not said t (+1)
- `tests/helpers/fake-d1.ts` — A D1 stand-in over node:sqlite (in memory), with the calls the app uses: prepare/bind/run/first/all and batch.
- `tests/helpers/setups.ts` — exporta: setupAt
- `tests/inducement.test.ts` — pruebas: bullish: BOS on the close above the swing high, the first real pullback is the I, swept and then structure failed: a close below the leg origin, not swept yet: pending, no outcome (+1)
- `tests/institutional-flows.test.ts` — pruebas: parseFlowDays drops rows that are not reported sessions, parseFlowDays returns days oldest first regardless of source order, a holiday does not extend a streak across it (+1)
- `tests/jarvis-analyst.test.ts` — pruebas: the analyst never reads a candle still forming, on any timeframe (no lookahead), a steady advance reads alcista on every timeframe, with the evidence listed and , a coil under a level is reported as about to break, and too little history gives
- `tests/jarvis-backtest-run.test.ts` — pruebas: history comes in pages of 1000, contiguous and without repeats, when futures does not answer, spot does, and the source says so, a backtest from the phone: only closed candles, progress to the end, and the res (+1)
- `tests/jarvis-backtest.test.ts` — pruebas: the backtest trades with the desk and the paper rules, one trade at a time, no lookahead: changing the future after a moment never changes the trades that c, the desk at a past hour only sees candles closed at that hour, and no history it (+1)
- `tests/jarvis-chat.test.ts` — pruebas: only question and answer turns are kept, trimmed and bounded, the thread comes back in order, and only to its owner, a thread older than six hours starts fresh, as the Telegram thread does (+1)
- `tests/jarvis-core.test.ts` — pruebas: the 15-minute cycle covers 20 coins, 3 magnets, one resolution and a study minut, live reading: no lookahead, the same 200-candle window as the history walk, grad, magnet sweeps from the stored previous map: swept and closed back = reversal sig (+1)
- `tests/jarvis-desk-risk.test.ts` — pruebas: the risk manager judges a market entry at today, no live price: nothing is assumed, the plan stands on its own numbers, a size that does not fit the capital at a safe leverage is NO TRADE; one that fi (+1)
- `tests/jarvis-desk-run.test.ts` — pruebas: risk settings: nonsense falls back to the safe defaults, never to a bigger risk, risk settings round-trip; leverage is a whole number, nothing cached is nothing, not a made-up decision (+1)
- `tests/jarvis-desk.test.ts` — pruebas: the desk never reads a candle still forming, on any series (no lookahead), a steady advance is never read as a short; any plan has its stop and targets on , a steady decline is never read as a long (+1)
- `tests/jarvis-learn.test.ts` — pruebas: encoding: one column per non-baseline value,, the regression recovers real effects, and says, incremental sums equal the batch, whatever the order (+1)
- `tests/jarvis-ledger.test.ts` — pruebas: breakout: long at the close, stop under the recent lows (1–2,5 ATR), target 2R, magnet: only a swept-and-rejected zone on the last candle; reversal toward the o, resolution: target, stop, both in one candle = stop, time exit, untouched stays  (+1)
- `tests/jarvis-local.test.ts` — pruebas: the screen made explicit: the PUMP tab, the map of the coin in focus, or nothing, with no AI, the local analyst answers: the asset
- `tests/jarvis-memory.test.ts` — pruebas: notes are kept tidy: no leading, memory: per person, the same note once, the oldest dropped past the limit, forgo, every brain gets the notes as one block; none, nothing (+1)
- `tests/jarvis-mind-verify.test.ts` — pruebas: numbers are read the Argentine way, and broken ones are not numbers, the 19:17 reading: the broken number and the magnet called support are taken out, a price off by thousands (the old (+1)
- `tests/jarvis-mind.test.ts` — pruebas: the answer, a thesis is kept only as a real plan from the current price, the hourly mind: once an hour from hh:17, with fresh reads only, theses checked  (+1)
- `tests/jarvis-paper-run.test.ts` — pruebas: signed in but the record does not answer: an honest error, never an empty list t, signed out: the record lives on this device, opens once, refuses stale plans, re, signed in: opened and advanced through the server, whose version wins (+1)
- `tests/jarvis-paper.test.ts` — pruebas: three targets: a third at each, fees on both sides, a candle that touches the stop and a target counts as the stop, TP1 then the stop: a third won, two thirds lost; the stop does not move (+1)
- `tests/jarvis-voice.test.ts` — pruebas: voices: Cloudflare, synthesis: premium voice first; the simpler one if premium fails or is not allow, allowance: per person and premium for everyone, per UTC day (+1)
- `tests/jarvis-watch-run.test.ts` — pruebas: switched off, the watch asks nothing, switched on: alerts published once, remembered across runs, memory kept on this 
- `tests/jarvis-watch.test.ts` — pruebas: a close across a desk level is a break, once per candle, with its stars, a change of structure needs a recent previous reading, volume, funding and open interest past their thresholds; missing derivatives fir (+1)
- `tests/jarvis.test.ts` — pruebas: normalize strips accents, punctuation and the case, coins by name, ticker or alias; ambiguous Spanish words need a cue, timeframes in words or short form (+1)
- `tests/key-levels.test.ts` — pruebas: a range turned at 110 and 100 four times: strong resistance above, strong suppor, two turns make a weak level; one turn is not a level, which side a level is on depends only on where price closed (+1)
- `tests/klines-server-fallback.test.ts` — pruebas: spot 403 (blocked data centre): one try per firewall, then futures; next calls s, spot working: unchanged; thin market only after spot and futures fail, Binance refuses the server: Kraken in dollars, with the reason; Binance is not a (+1)
- `tests/level-engine.test.ts` — pruebas: day and week references: yesterday, references never use a day that has not closed by, volume profile: POC where most volume traded, value area around it (+1)
- `tests/liq-vol-signals.test.ts` — pruebas: a swept swing low, closed back above on high volume, is a LONG with stop beyond , no signal without the volume, or when the candle closes below the level (that is, a swept swing high is the mirror-image SHORT (+1)
- `tests/liquidation-columns.test.ts` — pruebas: prices follow the liquidation formula at each sampled entry, for every tier and , the weights of all levels add up to the candles, open-interest change replaces volume where known, and a contraction opens nothin (+1)
- `tests/liquidation-heatmap.test.ts` — pruebas: every leverage distribution sums to 1, so density totals aren, volume profile spreads a candle, a bin remembers the earliest candle that put volume there (+1)
- `tests/liquidation-tiers.test.ts` — pruebas: each bucket carries its per-leverage split, and the split sums back to the bucke, with every tier on, the filter reproduces the original map exactly, a subset of tiers holds strictly less than the whole, in density and in dollars (+1)
- `tests/liquidity-pools.test.ts` — pruebas: two highs at nearly the same price form a buy-side pool, a single high, with nothing equal, forms no pool, a wick through the level sweeps it — a close back below does not save it (+1)
- `tests/live-feed.test.ts` — pruebas: the socket uses the routed /market URL, an open socket that delivers nothing is not called live, live is claimed on the first candle, and the price reaches the chart (+1)
- `tests/live-market.test.ts` — pruebas: a forced SELL is a long liquidated; a forced BUY is a short, notional uses the average fill, not the order, empty fill fields fall back to the order (+1)
- `tests/magnet-watch.test.ts` — pruebas: strongest magnet each side, by density, within range, CERCA: a strong magnet within half an ATR (at least 0,4%), BARRIDA: the last candle trades through a magnet of the previous map; rejection  (+1)
- `tests/market-providers.test.ts` — pruebas: each exchange, Bybit: funding per 8 h whatever the contract, OKX: funding brought to 8 h, OI in dollars and its 24 h change, accounts ratio a (+1)
- `tests/market-structure-cmc.test.ts` — pruebas: CoinMarketCap: dominance, totals and the stablecoin shares from the server, CoinMarketCap: a missing stablecoin answer is unknown, never zero; a broken answ
- `tests/mm-robot.test.ts` — pruebas: liquidity at a moment: only levels formed by then and not yet taken, within rang, target: the pool when it is 1R–4R away, otherwise 2R, filters: volume, flushed liquidations, liquidity on the target side, trend (+1)
- `tests/mtf-zones.test.ts` — pruebas: a level present on two timeframes is reported with both, one level is one row, not one row per timeframe, price inside a zone is reported as standing in it (+1)
- `tests/news-sentiment.test.ts` — pruebas: headlines are classified by fundamental type, security incidents outrank everything else in the same headline, a strong verb in a fundamental category is high impact (+1)
- `tests/order-blocks.test.ts` — pruebas: a down candle before a structure-breaking impulse is a bullish block, the mirror case produces a bearish block, an impulse too small against recent range is not a block (+1)
- `tests/order-flow-brain.test.ts` — pruebas: a thin sample produces no institutional claims, calm two-sided flow does not manufacture icebergs, detects hidden size refilling far beyond the displayed depth (+1)
- `tests/order-flow.test.ts` — pruebas: niceStep snaps to 1/2/5 decades, niceStep rejects non-positive and non-finite input, percentile handles empty and single-value input (+1)
- `tests/oscillators.test.ts` — pruebas: RSI is 100 on a series that only rises and ~50 on alternating moves, EMA seeds with the simple average, then smooths, MACD is positive in an uptrend and the histogram is line minus signal (+1)
- `tests/paper-bot.test.ts` — pruebas: sizing: the stop loses exactly riskPct of the account; margin is notional over l, margin cap: a tight stop can, target hit is a win, paying fees on both sides (+1)
- `tests/pre-breakout.test.ts` — pruebas: a tight range pressing a twice-tested ceiling with rising lows reads as a bullis, the mirror image reads as bearish against a floor, no level nearby: no direction is claimed (+1)
- `tests/price-alerts-server.test.ts` — pruebas: create: reads the price, settles the number, infers the direction, confirms, create: refuses what it can, create: at most ten per person (+1)
- `tests/price-alerts.test.ts` — pruebas: symbols: bare coins get USDT, pairs are kept, junk is refused, prices written the Argentine way and the English way both land on what was meant, unreadable prices are refused, not guessed (+1)
- `tests/pump-plan.test.ts` — pruebas: accumulation: buy stop above the range, stop inside it, targets in R, ignition: entry at the price with the stop under the last candles, ignition too stretched: wait for the retest of the broken high (+1)
- `tests/pump-pressure.test.ts` — pruebas: a market that tightened reads as compressed, a market with a constant range shows no pressure, pressure is direction-free — it never moves with the bias (+1)
- `tests/pump-radar.test.ts` — pruebas: screener ignores assets without a 5m window, screener enforces the liquidity floor, screener rewards acceleration over a slow grind (+1)
- `tests/radar.test.ts` — pruebas: global risk reports unavailable rather than zero without events, unconfirmed events are discounted, never actioned, an extreme confirmed event raises the advisory flag (+1)
- `tests/rendered-html.test.mjs` — pruebas: server-renders the branded Spanish application shell, keeps persistent signal history and automation wired, contains the requested ownership and safety language (+1)
- `tests/risk-calc.test.ts` — pruebas: size is the risk budget over the loss per unit at the stop, fees and slippage in, liquidation is estimated per side and the stop, targets pay R times the distance, less fees and slippage both ways (+1)
- `tests/risk.test.ts` — pruebas: sizes the position from the stop distance, losing the stop distance costs exactly the risk budget, or says why not, a capped position is always reported, never silent (+1)
- `tests/robot-signals.test.ts` — pruebas: a well-formed signal passes and keeps its numbers, inconsistent or hostile input is rejected, one key per coin, timeframe, candle and side: the same signal is never sent twic (+1)
- `tests/scalp-signals.test.ts` — pruebas: every signal obeys the setup, NO LOOKAHEAD: adding later candles never changes or removes an earlier signal, deterministic: the same series always yields the same signals (+1)
- `tests/scenario-analysis.test.ts` — pruebas: with a level above and below, both directional scenarios are built, neither directional scenario is favoured over the other, the target is the next level far enough away to be distinct from the trigger (+1)
- `tests/shared-cache.test.ts` — pruebas: one database read per TTL however many requests; a drop forces the next read
- `tests/signal-confluence.test.ts` — pruebas: a long aims at the zone above and is invalidated at the one below, a short mirrors it, the map (+1)
- `tests/signal-plan-db.test.ts` — pruebas: the plan columns are added once, only the missing ones, and never to a table tha, a plan is written next to its signal and the evaluator settles it from the candl, an open signal keeps its partial hits and is re-read next time; an unchanged one (+1)
- `tests/signal-plan.test.ts` — pruebas: ATR: the average true range of the last 14 candles, or nothing without enough, LONG plan: stop beyond the swing, kept between 1 and 2.5 ATR, targets at 1, 2 an, SHORT plan mirrors it (+1)
- `tests/speech-text.test.ts` — pruebas: numbers in Spanish words, with apocope and the 100/1000 forms, decimal comma, thousands dot and short decimals as said aloud, JARVIS text becomes speakable words: %, +R, US$, tickers, trading English, emoji (+1)
- `tests/spot-strategy.test.ts` — pruebas: all conditions present reads as present, never as a buy order, without a location condition it cannot be, the entry ladder puts the largest tranche at the lowest level (+1)
- `tests/structure-archive.test.ts` — pruebas: series change is the difference in percentage points, a falling series reports a negative change, gaps in the series are skipped, not treated as zero (+1)
- `tests/supply-demand.test.ts` — pruebas: a quiet base followed by an impulsive departure is a demand zone, a wide base is not a zone — that is a move, not a level, a touch that holds VALIDATES the zone instead of consuming it (+1)
- `tests/swing-entries.test.ts` — pruebas: pivots need confirmation on both sides, the latest extreme is not a pivot until it is tested, no setup without enough history (+1)
- `tests/swing-liquidity-filter.test.ts` — pruebas: a stop sitting inside a dense zone is moved beyond it, a stop already clear of the liquidity is left exactly where it was, faint zones do not justify widening risk (+1)
- `tests/telegram-ai.test.ts` — pruebas: markdown becomes Telegram HTML, and raw HTML from the model is escaped, long answers are split under Telegram, the server snapshot is bounded and says what it does not contain
- `tests/telegram-signals.test.ts` — pruebas: the message with a plan: entry, stop with its distance, three targets with their, a big enough sample drops the caveat; no stats means no history line; no plan ke, /resultados and its aliases are commands; other text is still a question for the (+1)
- `tests/telegram-voice.test.ts` — pruebas: a note too long or too heavy is refused in words; a short one goes through, what Whisper heard is cleaned; silence and stray dots are nothing heard, the answer is spoken without markdown, in whole sentences; the rest stays in the (+1)
- `tests/telegram-volume.test.ts` — pruebas: the Telegram message: one key per candle, its own category, escaped text, and th, preferences saved before this category existed read it as on; an explicit off st, selection: sent when on, skipped when off, never twice, and folded into the summ (+1)
- `tests/telegram.test.ts` — pruebas: signals below the user, disabled categories are never sent, an event already sent is never sent twice (+1)
- `tests/timeframes.test.ts` — pruebas: the selector order and the config table describe exactly the same timeframes, 3m, 2h and 8h are present, every frameMs matches what its id says, so a typo can (+1)
- `tests/token-unlocks.test.ts` — pruebas: overhang is the locked supply valued at today, the ceiling is the larger of total and max supply, a fully circulating token shows no overhang rather than a negative one (+1)
- `tests/trade-bubbles.test.ts` — pruebas: automatic: the top 0,5% of on-screen orders, sides from the aggressor, biggest d, only orders inside the visible window count, for the threshold too, a fixed minimum replaces the automatic one (+1)
- `tests/trade-journal.test.ts` — pruebas: a long profits when price rises, sized by the recorded USD amount, a short profits when price falls — the sign is flipped, not the math, an open trade has no P&L yet — not zero, genuinely unknown (+1)
- `tests/trendlines.test.ts` — pruebas: pivots: the first of equal highs counts, edges are never pivots, a resistance line through three swing highs, and the close that breaks it, before the break the same line is standing, and nothing is reported broken (+1)
- `tests/upstream-cache.test.ts` — pruebas: first read loads, second is served from cache, concurrent readers coalesce into one upstream call, an expired entry is refreshed (+1)
- `tests/volume-spike.test.ts` — pruebas: 3.5× the average of the previous 20 is a spike; just under 3× is not; exactly 3×, only the 20 candles before the last count: an older spike doesn, not enough history, no baseline, or unusable numbers: nothing is reported (+1)
- `tests/web-push.test.ts` — pruebas: the VAPID token is addressed to the push service, not to us, a different endpoint host produces a different audience, the token expires within the window push services accept (+1)
- `tests/workspace-sections.test.ts` — pruebas: every Collapsible section id is registered in WORKSPACE_SECTIONS, WORKSPACE_SECTIONS has no id without a matching Collapsible to open, every section belongs to one of the declared groups (+1)
- `tests/xau-alerts.test.ts` — pruebas: gold and silver by any common name, and real coins untouched, the metals live on the futures API; everything else on spot, gold prices keep their cents and both writing habits work (+1)

### app-movil — Interfaz, PWA y celular primero (95)
Texto: la app que se ve y se usa, pensada primero para el celular (mobile first) y después tablet y escritorio.
- `app/account-panel.css`
- `app/account-panel.tsx` — exporta: AccountPanel, default
- `app/active-signals.tsx` — exporta: ActiveSignals, default
- `app/agenda-macro.tsx` — exporta: AgendaMacro, default
- `app/alert-center.css`
- `app/alert-toasts.css` — Banners sit above everything but clear of the phone's bottom nav, and are click-through except on the cards themselves, so they never block a tap on the chart underneath.
- `app/asset-flows.css`
- `app/asset-flows.tsx` — exporta: AssetFlowDesk, default
- `app/assistant-console.css`
- `app/big-trades-desk.css`
- `app/big-trades-desk.tsx` — exporta: BigTradesDesk, default
- `app/bookmap-interactions.css`
- `app/bookmap-premium.css`
- `app/bookmap-pro.css`
- `app/bookmap-timeframe-chart.tsx` — exporta: BookmapTimeframeChart, default
- `app/bookmap-timeframe.css`
- `app/bot-desk.css` — Paper futures bot + macro agenda.
- `app/bot-desk.tsx` — exporta: BotDesk, default
- `app/bot-journal.tsx` — exporta: BotJournal, default
- `app/chatgpt-auth.ts` — exporta: ChatGPTUser, getChatGPTUser, requireChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath
- `app/compare-chart.css`
- `app/compare-chart.tsx` — exporta: CompareChart, default
- `app/component-header-reset.css` — Keep the application chrome rule from leaking into semantic headers inside widgets.
- `app/correlation-watch.css`
- `app/correlation-watch.tsx` — exporta: CorrelationInsights, CorrelationWatch, default
- `app/dashboard-settings.ts` — exporta: DashboardSettings, DEFAULT_DASHBOARD_SETTINGS, useDashboardSettings
- `app/dca-desk.css`
- `app/decoupling-desk.css` — SUBEN SOLAS: coins rising on their own while BTC and ETH don't.
- `app/decoupling-desk.tsx` — exporta: DecouplingDesk, default
- `app/diario-desk.css` — Account journal: tabs, filters, chart, trade detail, calculator, data tools.
- `app/diario-format.ts` — exporta: usd, money, px, qty, num, pf (+10)
- `app/diario-settings.ts` — exporta: DiarioSettings, DEFAULT_SETTINGS, SETTINGS_KEY, readSettings, Creds
- `app/exchange-flows.css`
- `app/exchange-flows.tsx` — exporta: ExchangeFlowDesk, default
- `app/flow-brain.css`
- `app/futures-desk.css`
- `app/futures-log-report.tsx` — exporta: FuturesLogReport, default
- `app/futures-recorder.tsx` — exporta: RecorderState, RecorderStatus, RECORDER_STATUS_EVENT, RECORDER_ROWS_EVENT, recorderStatus, FuturesRecorder (+1)
- `app/globals.css`
- `app/install-panel.css`
- `app/install-panel.tsx` — exporta: InstallPanel, default
- `app/institutional-desk.css`
- `app/institutional-desk.tsx` — exporta: InstitutionalDesk, default
- `app/laptop.css` — Laptop and desktop layer (≥1024 px), loaded last.
- `app/layout.tsx` — exporta: metadata, viewport, RootLayout, default
- `app/liquidation-heatmap-desk.css`
- `app/live-bookmap.tsx` — exporta: BookmapBrainReadings, LiveBookmap, default
- `app/market-brain.css`
- `app/market-structure-panel.tsx` — exporta: MarketStructurePanel, default
- `app/market-structure.css`
- `app/mobile-pro.css` — Mobile product layer: touch ergonomics, contained data density and safe-area navigation.
- `app/mtf-oscillators.tsx` — exporta: MtfOscillators, default
- `app/open-heatmap.css` — Open Heatmap responsive overrides, loaded after the dashboard stylesheet.
- `app/page.tsx` — exporta: Home, default
- `app/portfolio-risk.css`
- `app/portfolio-risk.tsx` — exporta: PortfolioRisk, default
- `app/prebreak-desk.css` — A PUNTO DE ROMPER
- `app/premium.css`
- `app/pressure-desk.css`
- `app/pressure-desk.tsx` — exporta: PressureDesk, default
- `app/pump-radar.css`
- `app/pwa-register.tsx` — exporta: PwaRegister, default
- `app/responsive-fixes.css` — Loaded last so it resolves layout conflicts between the earlier stylesheets.
- `app/risk-desk.css`
- `app/robot-signals-desk.css` — SEÑALES · ROBOT MM
- `app/scalping-desk.css`
- `app/secure-brain.css`
- `app/sentiment-desk.css`
- `app/sentiment-desk.tsx` — exporta: SentimentDesk, default
- `app/settings-desk.css`
- `app/settings-desk.tsx` — exporta: SettingsDesk, default
- `app/signal-ledger.css` — ── Señales abiertas con objetivo y riesgo ──
- `app/signal-ledger.tsx` — exporta: SignalLedger, default
- `app/spot-desk.css`
- `app/spot-desk.tsx` — exporta: SpotDesk, default
- `app/swing-desk.css`
- `app/swing-desk.tsx` — exporta: SwingDesk, default
- `app/trade-journal-desk.css`
- `app/unlock-desk.css`
- `app/unlock-desk.tsx` — exporta: UnlockDesk, default
- `app/workspace.css` — Workspace chrome: the bar that indexes every panel and the collapsible wrapper each section sits in.
- `app/workspace.tsx` — exporta: WorkspaceSection, WORKSPACE_GROUPS, WorkspaceGroup, WORKSPACE_SECTIONS, ESSENTIAL_IDS, setAdvanced (+6)
- `app/zones-desk.css`
- `app/zones-desk.tsx` — exporta: ZonesDesk, default
- `lib/account-events.ts` — Small browser events so any panel can open the account drawer, and every panel learns when someone signs in or out without reloading the page.
- `lib/visible-interval.ts` — setInterval that only runs while the tab is visible.
- `public/favicon.svg`
- `public/file.svg`
- `public/globe.svg`
- `public/icon-192.png`
- `public/icon-512.png`
- `public/manifest.webmanifest`
- `public/og.png`
- `public/sw.js`
- `public/window.svg`

## Sin objetivo

- ninguno

## Tablas D1

- `ai_free_usage` — crea: lib/ai-brains.ts, tests/telegram-voice.test.ts · usa: lib/ai-brains.ts, tests/ai-brains.test.ts, tests/jarvis-mind.test.ts, tests/telegram-voice.test.ts · sin índice visible en el código
- `ai_probe` — crea: lib/ai-probe.ts · usa: lib/ai-probe.ts · sin índice visible en el código
- `ai_usage` — crea: lib/ai-analyst-server.ts · usa: lib/ai-analyst-server.ts, tests/ai-brains.test.ts · sin índice visible en el código
- `app_settings` — crea: lib/app-settings.ts · usa: lib/app-settings.ts, tests/app-settings.test.ts, tests/binance-account.test.ts · sin índice visible en el código
- `automation_state` — crea: db/schema.ts, lib/automation.ts, tests/signal-plan-db.test.ts (+1) · usa: app/api/signals/route.ts, lib/automation.ts, lib/scalping-automation.ts, lib/signal-plan-db.ts, tests/signal-plan-db.test.ts, tests/telegram-signals.test.ts · sin índice visible en el código
- `binance_credentials` — crea: db/schema.ts, lib/auth.ts · usa: app/api/binance/credentials/route.ts, app/api/binance/link/route.ts · sin índice visible en el código
- `binance_debug_log` — crea: lib/binance-debug-log.ts · usa: lib/binance-debug-log.ts, tests/binance-debug-log.test.ts · sin índice visible en el código
- `binance_futures_log` — crea: lib/futures-log-db.ts · usa: lib/futures-log-db.ts · sin índice visible en el código
- `binance_futures_log_counts` — crea: lib/futures-log-db.ts · usa: lib/futures-log-db.ts · sin índice visible en el código
- `bot_journal` — crea: lib/bot-journal-db.ts · usa: lib/bot-journal-db.ts · sin índice visible en el código
- `bot_journal_counts` — crea: lib/bot-journal-db.ts · usa: lib/bot-journal-db.ts · sin índice visible en el código
- `brain_observations` — crea: app/api/brain/route.ts, db/schema.ts · usa: app/api/brain/route.ts · índices: brain_observations_symbol_timeframe_idx, brain_observations_evaluation_idx
- `brain_security_events` — crea: db/schema.ts, lib/brain-security.ts · usa: lib/brain-security.ts · índices: brain_security_events_time_idx, brain_security_events_symbol_idx
- `dca_purchases` — crea: lib/dca-tracker.ts · usa: app/api/dca/route.ts · índices: dca_purchases_user_idx
- `dca_schedules` — crea: lib/dca-tracker.ts · usa: app/api/dca/schedule/route.ts, lib/telegram-dispatch.ts · sin índice visible en el código
- `jarvis_chat` — crea: lib/jarvis-chat.ts · usa: lib/jarvis-chat.ts, tests/jarvis-chat.test.ts · índices: jarvis_chat_user
- `jarvis_core_signals` — crea: lib/jarvis-core-db.ts, tests/jarvis-core.test.ts · usa: lib/jarvis-core-db.ts, tests/jarvis-core.test.ts · índices: jarvis_core_open, jarvis_core_created, jarvis_core_closed, jarvis_core_busy
- `jarvis_core_state` — crea: lib/jarvis-core-db.ts · usa: lib/jarvis-core-db.ts, lib/jarvis-mind-db.ts, lib/jarvis-world.ts, tests/jarvis-mind.test.ts · sin índice visible en el código
- `jarvis_core_stats` — crea: lib/jarvis-core-db.ts · usa: lib/jarvis-core-db.ts · sin índice visible en el código
- `jarvis_memory` — crea: lib/jarvis-memory.ts · usa: lib/jarvis-memory.ts · índices: jarvis_memory_user
- `jarvis_mind` — crea: lib/jarvis-core-db.ts · usa: lib/jarvis-core-db.ts, lib/jarvis-mind-db.ts · sin índice visible en el código
- `jarvis_paper` — crea: lib/jarvis-paper-db.ts · usa: lib/jarvis-paper-db.ts · índices: jarvis_paper_recent
- `jarvis_paper_counts` — crea: lib/jarvis-paper-db.ts · usa: lib/jarvis-paper-db.ts · sin índice visible en el código
- `jarvis_voice_usage` — crea: lib/jarvis-voice-server.ts · usa: lib/jarvis-voice-server.ts · sin índice visible en el código
- `journal_fills` — crea: lib/diario-db.ts · usa: lib/diario-db.ts · sin índice visible en el código
- `journal_fills_counts` — crea: lib/diario-db.ts · usa: lib/diario-db.ts · sin índice visible en el código
- `journal_notes` — crea: lib/diario-db.ts · usa: lib/diario-db.ts · sin índice visible en el código
- `journal_notes_counts` — crea: lib/diario-db.ts · usa: lib/diario-db.ts, tests/diario-db.test.ts · sin índice visible en el código
- `liquidity_snapshots` — crea: db/schema.ts, lib/liquidity-history.ts · usa: lib/liquidity-history.ts · índices: liquidity_snapshots_market_time_idx, liquidity_snapshots_captured_idx
- `notas` — crea: tests/arana.test.ts · usa: tests/arana.test.ts · índices: notas_id
- `notes` — crea: examples/d1/db/schema.ts · usa: examples/d1/app/api/notes/route.ts · sin índice visible en el código
- `push_subscriptions` — crea: lib/web-push.ts, tests/web-push.test.ts · usa: app/api/push/subscribe/route.ts · sin índice visible en el código
- `sessions` — crea: db/schema.ts, lib/auth.ts · usa: lib/auth.ts · sin índice visible en el código
- `signal_records` — crea: db/schema.ts, lib/automation.ts, tests/signal-plan-db.test.ts (+1) · usa: app/api/alerts/latest/route.ts, app/api/performance/route.ts, app/api/signals/route.ts, app/api/telegram/webhook/route.ts, lib/automation.ts, lib/scalping-automation.ts (+5) · índices: signal_records_detected_idx, signal_records_symbol_side_idx, signal_records_status_idx
- `structure_snapshots` — crea: lib/structure-archive.ts · usa: lib/jarvis-mind-db.ts, lib/structure-archive.ts, lib/telegram-ai-server.ts · índices: structure_snapshots_time_idx
- `telegram_chat` — crea: lib/telegram-ai-server.ts · usa: lib/telegram-ai-server.ts · sin índice visible en el código
- `telegram_link_codes` — crea: lib/telegram.ts · usa: app/api/telegram/link/route.ts, app/api/telegram/webhook/route.ts, lib/telegram-dispatch.ts · sin índice visible en el código
- `telegram_links` — crea: lib/telegram.ts, tests/telegram-signals.test.ts · usa: app/api/alerts/prebreak/route.ts, app/api/jarvis/alert/route.ts, app/api/robot/signal/route.ts, app/api/telegram/link/route.ts, app/api/telegram/test/route.ts, app/api/telegram/webhook/route.ts (+4) · sin índice visible en el código
- `telegram_price_alerts` — crea: lib/price-alerts-server.ts · usa: app/api/telegram/webhook/route.ts, lib/price-alerts-server.ts · índices: telegram_price_alerts_user_idx
- `telegram_sent` — crea: lib/telegram.ts · usa: app/api/alerts/prebreak/route.ts, app/api/robot/signal/route.ts, app/api/telegram/webhook/route.ts, lib/telegram-dispatch.ts · sin índice visible en el código
- `telegram_state` — crea: lib/telegram.ts, tests/telegram-signals.test.ts · usa: app/api/admin/settings/route.ts, app/api/telegram/link/route.ts, app/api/telegram/webhook/route.ts, lib/telegram-dispatch.ts, lib/telegram-jarvis.ts, lib/telegram-server.ts (+1) · sin índice visible en el código
- `trade_journal` — crea: lib/trade-journal.ts · usa: app/api/journal/route.ts · índices: trade_journal_user_idx
- `users` — crea: db/schema.ts, lib/auth.ts · usa: app/api/auth/login/route.ts, app/api/auth/register/route.ts, lib/auth.ts · sin índice visible en el código

## Secretos y variables de entorno

- `anthropic_api_key` (secreto) — lee: app/api/admin/settings/route.ts, app/api/analyst/ai/route.ts, lib/telegram-ai-server.ts · guarda: app/api/admin/settings/route.ts
- `cmc_api_key` (secreto) — lee: app/api/admin/settings/route.ts, app/api/market-structure/route.ts · guarda: app/api/admin/settings/route.ts
- `groq_api_key` (secreto) — lee: app/api/admin/settings/route.ts, app/api/analyst/ai/route.ts, lib/jarvis-mind-db.ts, lib/telegram-ai-server.ts · guarda: app/api/admin/settings/route.ts
- `telegram_bot_token` (secreto) — lee: app/api/admin/settings/route.ts, app/api/alerts/prebreak/route.ts, app/api/jarvis/alert/route.ts, app/api/robot/signal/route.ts (+4) · guarda: app/api/admin/settings/route.ts
- variable `ASSETS` — en: worker/index.ts
- variable `CODEX_SANDBOX` — en: vite.config.ts
- variable `ENCRYPTION_KEY` — en: lib/app-settings.ts
- variable `GITHUB_SHA` — en: scripts/write-build-info.mjs
- variable `IMAGES` — en: worker/index.ts
- variable `MINIFLARE_REGISTRY_PATH` — en: vite.config.ts
- variable `WRANGLER_LOG_PATH` — en: vite.config.ts
- variable `WRANGLER_WRITE_LOGS` — en: vite.config.ts

## Rutas /api

- `/api/admin/settings` [GET, POST, PUT, DELETE] — app/api/admin/settings/route.ts · seguridad
- `/api/alerts/latest` [GET] — app/api/alerts/latest/route.ts · alertas
- `/api/alerts/prebreak` [POST] — app/api/alerts/prebreak/route.ts · alertas
- `/api/analyst/ai` [POST] — app/api/analyst/ai/route.ts · jarvis
- `/api/auth/login` [POST] — app/api/auth/login/route.ts · seguridad
- `/api/auth/logout` [POST] — app/api/auth/logout/route.ts · seguridad
- `/api/auth/me` [GET] — app/api/auth/me/route.ts · seguridad
- `/api/auth/register` [POST] — app/api/auth/register/route.ts · seguridad
- `/api/backtest/fibonacci` [GET] — app/api/backtest/fibonacci/route.ts · senales-radar
- `/api/binance/client-log` [POST] — app/api/binance/client-log/route.ts · binance-usuario
- `/api/binance/credentials` [GET] — app/api/binance/credentials/route.ts · binance-usuario
- `/api/binance/futures-log` [GET, POST] — app/api/binance/futures-log/route.ts · binance-usuario
- `/api/binance/link` [POST, DELETE] — app/api/binance/link/route.ts · binance-usuario
- `/api/bot/journal` [GET, POST] — app/api/bot/journal/route.ts · riesgo-diario
- `/api/brain` [POST] — app/api/brain/route.ts · senales-radar
- `/api/calendar` [GET] — app/api/calendar/route.ts · datos-mercado
- `/api/dca` [GET, POST, DELETE] — app/api/dca/route.ts · riesgo-diario
- `/api/dca/schedule` [GET, POST, DELETE] — app/api/dca/schedule/route.ts · riesgo-diario
- `/api/diario/fills` [GET, POST] — app/api/diario/fills/route.ts · riesgo-diario
- `/api/diario/notes` [GET, PUT] — app/api/diario/notes/route.ts · riesgo-diario
- `/api/etf-flows` [GET] — app/api/etf-flows/route.ts · datos-mercado
- `/api/exchange-flows` [GET] — app/api/exchange-flows/route.ts · datos-mercado
- `/api/institutional` [GET] — app/api/institutional/route.ts · datos-mercado
- `/api/jarvis/alert` [POST] — app/api/jarvis/alert/route.ts · jarvis
- `/api/jarvis/chat` [GET, POST, DELETE] — app/api/jarvis/chat/route.ts · jarvis
- `/api/jarvis/core` [GET] — app/api/jarvis/core/route.ts · jarvis
- `/api/jarvis/memory` [GET, POST, DELETE] — app/api/jarvis/memory/route.ts · jarvis
- `/api/jarvis/paper` [GET, POST, PUT] — app/api/jarvis/paper/route.ts · jarvis
- `/api/jarvis/voice` [GET, POST] — app/api/jarvis/voice/route.ts · jarvis
- `/api/journal` [GET, POST, DELETE] — app/api/journal/route.ts · riesgo-diario
- `/api/klines` [POST, GET] — app/api/klines/route.ts · datos-mercado
- `/api/liquidity-history` [GET, POST] — app/api/liquidity-history/route.ts · senales-radar
- `/api/market-structure` [POST, GET] — app/api/market-structure/route.ts · datos-mercado
- `/api/market/derivatives` [GET] — app/api/market/derivatives/route.ts · datos-mercado
- `/api/orderbook` [GET] — app/api/orderbook/route.ts · datos-mercado
- `/api/performance` [GET] — app/api/performance/route.ts · riesgo-diario
- `/api/push/subscribe` [POST, DELETE] — app/api/push/subscribe/route.ts · alertas
- `/api/radar` [GET] — app/api/radar/route.ts · senales-radar
- `/api/robot/signal` [POST] — app/api/robot/signal/route.ts · robots-papel
- `/api/rolling` [GET] — app/api/rolling/route.ts · datos-mercado
- `/api/scalping` [POST] — app/api/scalping/route.ts · senales-radar
- `/api/sentiment` [GET] — app/api/sentiment/route.ts · datos-mercado
- `/api/signals` [GET, POST] — app/api/signals/route.ts · senales-radar
- `/api/structure-trend` [GET] — app/api/structure-trend/route.ts · datos-mercado
- `/api/telegram/link` [GET, POST, PUT, DELETE] — app/api/telegram/link/route.ts · telegram
- `/api/telegram/test` [POST] — app/api/telegram/test/route.ts · telegram
- `/api/telegram/webhook` [POST] — app/api/telegram/webhook/route.ts · jarvis
- `/api/tickers` [GET] — app/api/tickers/route.ts · datos-mercado
- `/api/version` [GET] — app/api/version/route.ts · despliegue

## Hosts externos

- `alt-radar-cache.internal` — lib/shared-cache.ts
- `alt-radar-pro.pechiberman.workers.dev` — app/api/etf-flows/route.ts, app/layout.tsx
- `alt-radar-voice.internal` — lib/jarvis-voice-server.ts
- `api-gcp.binance.com` — app/api/tickers/route.ts, lib/automation.ts, lib/klines-server.ts, lib/telegram-ai-server.ts
- `api.alternative.me` — app/api/sentiment/route.ts, app/api/telegram/webhook/route.ts, lib/telegram-ai-server.ts, lib/telegram-dispatch.ts
- `api.anthropic.com` — app/api/admin/settings/route.ts, lib/ai-analyst-server.ts
- `api.binance.com` — app/api/brain/route.ts, app/api/klines/route.ts, app/api/orderbook/route.ts, app/api/radar/route.ts, app/api/rolling/route.ts, app/api/scalping/route.ts (+15)
- `api.binance.us` — app/api/scalping/route.ts, app/scalping-desk.tsx, lib/klines-server.ts, lib/scalping-automation.ts
- `api.bybit.com` — lib/market-providers.ts
- `api.coingecko.com` — app/api/market-structure/route.ts, app/api/radar/route.ts, app/radar-app.tsx, app/unlock-desk.tsx, lib/spot-plan-client.ts, lib/token-unlocks.ts (+1)
- `api.coinlore.net` — app/api/market-structure/route.ts, app/api/radar/route.ts, app/radar-app.tsx, lib/automation.ts, worker/index.ts
- `api.exchange.coinbase.com` — lib/klines-server.ts
- `api.groq.com` — lib/ai-brains.ts, lib/telegram-voice.ts, tests/arana.test.ts
- `api.hyperliquid.xyz` — lib/market-providers.ts
- `api.kraken.com` — app/api/orderbook/route.ts, lib/klines-server.ts
- `api.llama.fi` — lib/exchange-reserves.ts
- `api.telegram.org` — lib/telegram-voice.ts, lib/telegram.ts
- `api1.binance.com` — app/api/klines/route.ts, app/api/rolling/route.ts, app/api/tickers/route.ts, app/binance-klines.ts, lib/automation.ts, lib/binance-account.ts (+3)
- `api2.binance.com` — app/api/klines/route.ts, app/api/rolling/route.ts, app/api/tickers/route.ts, lib/automation.ts, lib/binance-account.ts, lib/klines-history.ts (+1)
- `api3.binance.com` — lib/automation.ts, lib/binance-account.ts, lib/klines-server.ts
- `api4.binance.com` — lib/automation.ts, lib/binance-account.ts
- `app.local` — app/chatgpt-auth.ts
- `bitcoinmagazine.com` — lib/crypto-news.ts
- `cdn-nfs.faireconomy.media` — app/api/calendar/route.ts
- `cointelegraph.com` — lib/crypto-news.ts
- `data-api.binance.vision` — app/api/brain/route.ts, app/api/klines/route.ts, app/api/orderbook/route.ts, app/api/radar/route.ts, app/api/rolling/route.ts, app/api/scalping/route.ts (+13)
- `decrypt.co` — lib/crypto-news.ts
- `example.test` — tests/radar.test.ts
- `fapi.binance.com` — app/api/brain/route.ts, app/api/orderbook/route.ts, app/big-trades-desk.tsx, app/bookmap-timeframe-chart.tsx, app/live-bookmap.tsx, app/market-brain.tsx (+5)
- `fapi.test` — tests/live-feed.test.ts
- `fapi1.binance.com` — app/api/brain/route.ts, app/big-trades-desk.tsx, app/bookmap-timeframe-chart.tsx, app/market-brain.tsx, lib/binance-futures.ts, lib/klines-server.ts (+2)
- `fapi2.binance.com` — app/api/brain/route.ts, app/big-trades-desk.tsx, app/bookmap-timeframe-chart.tsx, app/market-brain.tsx, lib/binance-futures.ts, lib/klines-server.ts (+2)
- `fapi3.binance.com` — app/api/brain/route.ts, app/bookmap-timeframe-chart.tsx, app/market-brain.tsx
- `fapi4.binance.com` — app/api/brain/route.ts, app/bookmap-timeframe-chart.tsx, app/market-brain.tsx
- `farside.co.uk` — app/api/etf-flows/route.ts
- `fcm.googleapis.com` — tests/web-push.test.ts
- `feeds.bbci.co.uk` — lib/news-intelligence.ts
- `feeds.content.dowjones.io` — lib/news-intelligence.ts
- `feeds.skynews.com` — lib/news-intelligence.ts
- `news.un.org` — lib/news-intelligence.ts
- `nextjs.org` — next-env.d.ts
- `nfs.faireconomy.media` — app/api/calendar/route.ts, lib/econ-calendar.ts
- `pro-api.coinmarketcap.com` — app/api/admin/settings/route.ts, app/api/market-structure/route.ts
- `rss.nytimes.com` — lib/news-intelligence.ts
- `spot.test` — tests/live-feed.test.ts
- `t.me` — app/api/telegram/link/route.ts
- `updates.push.services.mozilla.com` — tests/web-push.test.ts
- `www.aljazeera.com` — lib/news-intelligence.ts
- `www.cnbc.com` — lib/news-intelligence.ts
- `www.coindesk.com` — lib/crypto-news.ts
- `www.okx.com` — lib/market-providers.ts
- `www.tftc.io` — lib/institutional-flows.ts
- `www.theblock.co` — lib/crypto-news.ts
- `www.theguardian.com` — lib/news-intelligence.ts

## Código de navegador

- Raíz ("use client"): app/account-panel.tsx, app/active-signals.tsx, app/agenda-macro.tsx, app/alert-center.tsx, app/alert-toasts.tsx, app/asset-flows.tsx, app/assistant-console.tsx, app/big-trades-desk.tsx, app/binance-klines.ts, app/bookmap-timeframe-chart.tsx, app/bot-desk.tsx, app/bot-journal.tsx, app/compare-chart.tsx, app/correlation-watch.tsx, app/dashboard-settings.ts, app/dca-desk.tsx, app/decoupling-desk.tsx, app/diario-desk.tsx, app/diario-tools.tsx, app/diario-views.tsx, app/exchange-flows.tsx, app/futures-desk.tsx, app/futures-log-report.tsx, app/futures-recorder.tsx, app/install-panel.tsx, app/institutional-desk.tsx, app/jarvis-backtest.tsx, app/jarvis-paper.tsx, app/jarvis-trading.tsx, app/jarvis-watch.tsx, app/jarvis.tsx, app/liquidation-heatmap-desk.tsx, app/live-bookmap.tsx, app/market-brain.tsx, app/market-structure-panel.tsx, app/mtf-oscillators.tsx, app/portfolio-risk.tsx, app/prebreak-desk.tsx, app/pressure-desk.tsx, app/pump-radar.tsx, app/pwa-register.tsx, app/radar-app.tsx, app/risk-desk.tsx, app/robot-signals-desk.tsx, app/scalping-desk.tsx, app/sentiment-desk.tsx, app/settings-desk.tsx, app/sign-in-prompt.tsx, app/signal-ledger.tsx, app/spot-desk.tsx, app/swing-desk.tsx, app/telegram-card.tsx, app/trade-journal-desk.tsx, app/unlock-desk.tsx, app/workspace.tsx, app/zones-desk.tsx
- Problemas: ninguno

## Lib sin prueba directa

- `lib/account-events.ts`, `lib/automation.ts`, `lib/binance-futures.ts`, `lib/bot-journal-db.ts`, `lib/brain-security.ts`, `lib/futures-log-db.ts`, `lib/jarvis-world.ts`, `lib/klines-history.ts`, `lib/liquidity-archive.ts`, `lib/liquidity-history.ts`, `lib/market-brain.ts`, `lib/news-intelligence.ts`, `lib/scalping-automation.ts`, `lib/scalping-engine.ts`, `lib/signal-ledger.ts`, `lib/signal-plan-record.ts`, `lib/spot-plan-client.ts`, `lib/squeeze.ts`, `lib/telegram-server.ts`, `lib/visible-interval.ts`
