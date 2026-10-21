# ALT RADAR PRO — plataforma unificada: auditoría y primer incremento

Rama: `feature/pro-terminal-visual-refresh`, creada desde `main` (`ff0aa87`) el 21/10/2026. Nada de esto va a `main` ni a
producción sin revisión de la persona. Modo: análisis, backtest y papel. Ninguna orden real.

Este documento cubre la **fase A** (auditoría), la **fase B** (contratos) y lo que se pudo verificar de la **fase D**
(order flow y footprint) del pedido «Unified Institutional Intelligence». Las demás fases quedan como pasos siguientes,
al final.

## 1. Fuentes reales de datos (verificadas en el código)

| Dato | De dónde sale | Mercado | Límites conocidos |
|---|---|---|---|
| Velas OHLCV | `lib/market-fetch.ts` `loadRows`: Binance Futures primero, Spot si futuros no responde, copia del Worker al final. `meta.venue` dice cuál respondió. | Futures o Spot, según la respuesta | El Worker recibe 403 de Binance en los crons; ahí usa Kraken/Coinbase (`lib/klines-server.ts`, `venue`). |
| Delta por vela | Campo 9 de la vela de Binance (`takerBuy`), `lib/footprint.ts` `candleDelta` | El de la vela | Kraken y el estudio no lo traen: sin `takerBuy` el delta es `null`, no cero. |
| Operaciones con lado agresor | `/fapi/v1/aggTrades` (REST, hasta 6 páginas de 1000) y stream `@aggTrade` (`lib/live-feed.ts`, `app/live-bookmap.tsx`) | Futures (el bookmap también Spot) | Solo velas recientes. El mapa marca parcial la vela que no se vio entera. |
| Libro de órdenes | Stream `@depth` del bookmap (`app/live-bookmap.tsx`), instantáneas en D1 de BTC, ETH y SOL (`lib/liquidity-history.ts`) | Futures o Spot (bookmap, por `venue`) | Liquidez visible: se puede cancelar. No es liquidez ejecutada. |
| Liquidaciones reales | Stream `!forceOrder@arr` (`lib/live-market.ts`); historial de OKX en la mesa (`LiquidationTape`) | Futures | Binance manda como mucho una por símbolo y segundo: en una cascada subcuenta. |
| Derivados | Funding, interés abierto, largo/corto, flujo agresor (`lib/market-providers.ts`) | Futures | Bybit o el servidor cuando Binance no responde. |
| Contexto | Miedo y Avaricia, noticias, calendario económico, dominancia, flujos de ETF, reservas, desbloqueos | — | No encontré una serie de DXY ni de tasas: el calendario trae los eventos de la semana, no la serie. |
| Cuenta real | Binance (solo lectura, WebSocket API firmada desde el navegador); Axi (solo lectura) | — | Las claves de Binance no pueden tener retiros. |

**Órdenes reales: ninguna.** La única llamada de órdenes es `order.test` (`lib/binance-client-signed.ts`), que Binance
valida sin enviar. `lib/jarvis-execution.ts` arma un ticket para que la persona cargue la orden a mano. Ahora lo
comprueba `tests/sin-ordenes-reales.test.ts`.

## 2. Los quince roles contra lo que ya existe

| Rol pedido | Qué hay | Qué falta |
|---|---|---|
| 1. Macro & Regime | Especialistas `macro`, `correlacion` y `volatilidad` de la mesa (`lib/jarvis-desk-agents.ts`); JARVIS MENTE horaria (`lib/jarvis-mind.ts`); calendario, dominancia, `lib/decoupling.ts` | DXY y tasas sin fuente; régimen como dato único compartido |
| 2. Value & Capital Preservation | Desbloqueos de tokens, reservas de exchanges | No hay metodología de valuación: no se inventa. Sí se puede medir liquidez y concentración |
| 3. Price Action & Structure | `estructura`, `tecnico` de la mesa; `lib/market-structure*.ts`, niveles, order blocks, FVG, líneas, patrones; analista 1h/4h/1d (`lib/jarvis-analyst.ts`) | Conectarlo al contexto común |
| 4. Footprint Specialist | `lib/footprint.ts` (celdas, POC, desequilibrio diagonal 3×, apilados, veredicto), mapa de liquidaciones | Área de valor y huecos: **hechos en este incremento** (sección 4) |
| 5. Order Flow & Tape | `lib/big-trades.ts`, `lib/trade-bubbles.ts`, `lib/order-flow-brain.ts`; mesa de flujo de 5 agentes (`lib/flujo-agentes.ts`) | CVD por operación dentro del contexto común |
| 6. Liquidity & Microstructure | Paredes del libro (`lib/order-flow.ts`), mapa de calor, liquidaciones reales, historial de liquidez | Modelo de deslizamiento con el libro (hoy es un supuesto fijo, `lib/lab-evaluacion.ts`) |
| 7. Trend Following | Agentes de papel SUPERTREND, RUPTURA, CRUCE_EMA, ST_MTF… (`lib/estrategias.ts`, 27 con el control AZAR) | — |
| 8. Reflexivity & Sentiment | `noticias` y `sentimiento` de la mesa | Narrativa contra precio como lectura propia |
| 9. Quant Research | Desarrollo/evaluación por fecha (`lib/lab-evaluacion.ts`), PSR/DSR, White y Hansen (`lib/sobreajuste.ts`), laboratorio en sombra con medición hacia adelante (`lib/mesa-sombra*.ts`), estudios en `docs/` | Walk-forward como herramienta común de todos los motores |
| 10. Risk Manager | Compuerta central con veto (`lib/lab-riesgo.ts`): por operación, exposición, pérdida del día, drawdown, por activo y estrategia; la mesa decide NO TRADE si el riesgo no cierra (`lib/jarvis-desk.ts`) | Riesgo agregado por correlación entre estrategias |
| 11. Scalping | `lib/scalping-engine.ts` (WATCH/SETUP/TRIGGER/NO SIGNAL), `lib/scalp-signals.ts` | Spread y costos como veto explícito |
| 12. Day Trading | — | Motor propio, separado del scalping y del swing |
| 13. Swing | Agentes de papel en 4h, `lib/swing-entries.ts`, filtro de liquidez | Separar sus estadísticas como motor |
| 14. La Araña | Escaneo y foto en vivo (`lib/arana-vivo*.ts`), escáner de JARVIS (`lib/jarvis-scan*.ts`) | Clasificar candidatos por calidad de datos (con el contexto común) |
| 15. JARVIS coordinador | Mesa con especialistas, debate alcista contra bajista y riesgo que manda: LONG, SHORT, ESPERAR o NO TRADE (`lib/jarvis-desk.ts`); cascada de IA; JARVIS sobre el laboratorio | Registro auditable de cada decisión con su contexto; «qué cambió desde la anterior» |

El consenso entre agentes (`lib/consenso.ts`) ya se guarda sin filtrar ni decidir: la cantidad de agentes de acuerdo no
se usa como probabilidad, como pide el documento.

## 3. El pipeline pedido contra lo que ya existe

| Paso | Estado |
|---|---|
| 1–2. Ingesta y normalización | Existe por panel (`loadRows`, parsers de aggTrade, forceOrder y kline). No hay una capa única. |
| 3. Control de calidad | Parcial: velas solo cerradas, `takerBuy` faltante = null, «sin datos» en la araña. **Contrato común nuevo** (sección 5). |
| 4. Market snapshot | `DeskSnapshot` de la mesa (`lib/jarvis-desk-data.ts`). Ahora guarda de qué fuente salieron las velas y se envuelve en el contexto común. |
| 5–6. Features, footprint y flujo | Existen; footprint y flujo viven en el mapa y el bookmap, fuera de la foto de la mesa. |
| 7. La Araña | Existe. |
| 8–9. Agentes y examen cruzado | Existe en la mesa (debate alcista/bajista). |
| 10. Riesgo | Existe (`lib/lab-riesgo.ts`, veto de la mesa). |
| 11–12. JARVIS y libro de señales | Existe: registro unificado (`lib/registro.ts`, única fuente de acierto, PF y expectancia, con muestra e intervalo), escalera SL/TP1/TP2/TP3 (`lib/escalera.ts`), peor caso primero si una vela toca stop y objetivo. |
| 13. Papel | Existe (navegador y servidor 24 h, con riesgo central). |
| 14. Performance | Existe (oficina, laboratorio, registro). |
| 15. UI | Existe; rediseño pendiente (fase F). |

## 4. Fase D: lo que se verificó del order flow

1. **Delta por vela** (`candleDelta`): compra agresora = `takerBuy`, venta = volumen − compra, recortado a [0, volumen].
   Sin `takerBuy`, `null`. Correcto, con pruebas.
2. **CVD**: acumula y sigue a través de velas sin dato (no las cuenta como cero). Correcto, con pruebas.
3. **Footprint del mapa**: celdas por precio con el lado del agresor (`m` de aggTrade: comprador maker = venta agresora).
   Correcto. Problemas encontrados y corregidos:
   - Una vela se daba por **completa** solo por la hora de la primera operación vista: un corte del stream en el medio
     no se notaba. Ahora se miran los **ids de aggTrade** (consecutivos por símbolo): un hueco dentro de una vela o entre
     dos marca las dos como parciales (`gaps`), y una operación repetida (REST y stream) cuenta una sola vez.
   - El **POC** dependía del orden de llegada en un empate. Ahora: el más cercano al medio del rango y después el más bajo.
   - No tenía **área de valor**. Ahora tiene `val` y `vah` (función `valueArea`).
4. **Footprint del bookmap** (`lib/order-flow.ts`): el comentario decía «caminando desde el POC», pero el código tomaba
   los niveles de más volumen en cualquier lugar (banda **no contigua**) y solo entre las 16 filas a la vista. Ahora usa
   la misma `valueArea` sobre todos los niveles operados.
5. **Metodología del área de valor** (documentada en `lib/footprint.ts`): método CBOT de Market Profile. Desde el POC se
   compara el par de niveles de arriba con el de abajo, se suma el de más volumen (en empate, los dos) hasta el 70 %.
   Puede pasarse un poco porque suma de a dos niveles. `val` y `vah` son niveles, no bordes.
6. **Spot y Futures**: el mapa pide las velas a futuros y, si no responde, a Spot; las operaciones del footprint son
   siempre de futuros. Antes podía dibujar operaciones de futuros sobre velas spot. Ahora el footprint se apaga y lo dice
   cuando las velas no son de futuros.
7. **Sigue pendiente**: hay dos implementaciones de footprint con unidades distintas (el mapa en moneda base, el bookmap
   en dólares) y dos definiciones de desequilibrio (diagonal en el mapa, horizontal en el bookmap). Unificarlas es parte
   de la fase C; mientras tanto, cada panel dice qué muestra.

## 5. Fase B: el contrato común (`lib/contexto-comun.ts`)

- `Dato<T>`: valor, **calidad** (`OK`, `STALE_DATA`, `DATA_UNAVAILABLE`, `INSUFFICIENT_DATA`), motivo, fuente, **mercado**
  (Spot o Futures, o `null` si la fuente no lo declara), hora del dato, hora de recepción, temporalidad, unidad y método.
- `velasComoDato`: ordena, une repetidas idénticas, descarta incoherentes y repetidas con valores distintos (y lo dice),
  deja afuera la vela que todavía no cerró, y marca viejas (más de dos velas sin cierre nuevo) e insuficientes.
- `mercadoDeFuente`, `mercadoComun`, `mismoMercado`: Spot y Futures no se mezclan; sin mercado declarado no se supone.
- `contextoDesdeMesa`: envuelve la `DeskSnapshot` de la mesa (no crea otra foto). Footprint y libro quedan declarados
  como `DATA UNAVAILABLE` con el motivo hasta que la mesa los reciba.
- `compatibles`: dos agentes miran la misma foto si coinciden símbolo, mercado declarado, momento (con tolerancia) y la
  última vela cerrada de cada temporalidad.
- Versión de la metodología: `CONTEXTO_1`, dentro del id de cada contexto.

## 6. Pruebas agregadas

- `tests/contexto-comun.test.ts`: estados de calidad, velas incoherentes y repetidas, Spot/Futures, foto de la mesa,
  compatibilidad entre fotos y que no se usa una vela sin cerrar.
- `tests/footprint-area-valor.test.ts`: área de valor con datos conocidos, contigüidad, POC determinista, huecos de ids
  dentro y entre velas, operación repetida, que lo posterior no cambia lo anterior y el área de valor del bookmap.
- `tests/sin-ordenes-reales.test.ts`: ningún archivo de `lib/`, `app/` ni `worker/` crea, cambia o cancela órdenes.

## 7. Pasos siguientes (en orden)

1. **Fase C**: que la mesa, la araña y los agentes lean `ContextoComun` y se abstengan con su motivo cuando una parte que
   necesitan no está OK. Llevar al contexto el footprint y el CVD por operación, y el libro, con su mercado.
2. Unificar las dos implementaciones de footprint (unidades y desequilibrio) sobre `lib/footprint.ts`.
3. **Fase E**: registrar cada decisión de JARVIS con el id del contexto, los agentes consultados, el veto y qué cambió
   desde la anterior, dentro del registro unificado (sin otro registro paralelo).
4. Motor de **day trading** propio; separar las estadísticas de scalping, day y swing en el registro.
5. Riesgo agregado por correlación en `lib/lab-riesgo.ts`; deslizamiento estimado con el libro, como modelo documentado.
6. **Fase F**: rediseño visual (pantalla principal, terminal de activo, centro de inteligencia con el mapa 3D, laboratorio
   de rendimiento y centro de riesgo), celular primero.

No es asesoramiento financiero: todo lo medido es del pasado o de papel, con su muestra.
