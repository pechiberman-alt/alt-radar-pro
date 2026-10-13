# La mesa de JARVIS: reglas v2

Qué cambió respecto de la versión anterior, cómo se midió y qué no demuestra.
Es una medición del pasado, simulada: **no garantiza rentabilidad futura y no es asesoramiento financiero.**

## Qué cambió

| Regla | v1 | v2 |
| --- | --- | --- |
| Margen del stop detrás del nivel que lo defiende | 0,25 ATR de 4 h | 1 ATR de 4 h |
| Consenso mínimo para tomar un lado | ±0,15 | ±0,30 (el veto «va en contra de este lado» sigue desde ±0,15) |
| Stop al cobrar el TP1 | fijo | pasa a la entrada |

Cuando la vela que cobra el TP1 también toca la entrada, no se sabe qué pasó primero: se cuenta el peor caso, y el resto sale en la entrada (igual que si una vela toca stop y objetivo, cuenta el stop).

Cada operación de papel guarda con qué reglas se abrió (`reglas`, `gestion`). Las que se abrieron antes de v2 siguen con el stop fijo: el plan que mostró la tarjeta no se edita después. El código está en `lib/jarvis-desk.ts` (constantes `DESK_RULES`, `STOP_BUFFER_ATR`, `CONSENSUS_EDGE`) y `lib/jarvis-paper.ts` (salida `BE`); los tests, en `tests/jarvis-rules-v2.test.ts`.

## Cómo se midió

- El backtest real de la app (`lib/jarvis-backtest.ts`): la misma mesa y las mismas reglas del papel, una operación a la vez por moneda, decisión en cada cierre de 4 h con solo velas ya cerradas, comisión de 0,05% por lado, peor caso primero.
- 10 monedas grandes y líquidas (BTC, ETH, SOL, BNB, XRP, TRX, DOGE, ZEC, ADA, BCH) con velas de Binance de 1 h, 4 h y 1 d hasta el 30/09/2026.
- Tres períodos que no se superponen: 2021-01 → 2024-02, 2024-02 → 2025-06 y 2025-07 → 2026-09.
- Sin derivados, noticias ni calendario históricos: esos especialistas pesan cero en el backtest (en vivo sí leen).
- Las reglas v1 se midieron con un simulador de investigación que reproduce la mesa anterior operación por operación (coincide con su backtest real salvo 10 de 2.884 operaciones, con el mismo resultado en R). Las v2, con el backtest real de la app.

## Resultados (10 monedas, comisión 0,05% por lado)

| Período | Reglas | Operaciones | Win rate | Profit factor | Expectativa | Total | Peor caída |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2024-02 → 2025-06 | v1 | 1.523 | 33% | 1,01 | +0,01 R | +10 R | 81 R |
| | v2 | 897 | 45% | 1,15 | +0,08 R | +68 R | 47 R |
| 2025-07 → 2026-09 | v1 | 1.356 | 35% | 1,11 | +0,07 R | +95 R | 63 R |
| | v2 | 778 | 46% | 1,22 | +0,12 R | +89 R | 50 R |
| 2021-01 → 2024-02 | v1 | 3.598 | 35% | 1,09 | +0,05 R | +196 R | 132 R |
| | v2 | 1.983 | 45% | 1,16 | +0,08 R | +161 R | 66 R |
| Últimos 180 días | v1 | 515 | 37% | 1,16 | +0,09 R | +49 R | — |
| | v2 | 305 | 44% | 1,11 | +0,06 R | +18 R | — |

Lo que dicen los números:

- v2 mejora el win rate, el profit factor, la expectativa por operación y la peor caída en los tres períodos largos. Opera menos (casi la mitad) y el total en R es parecido, no mayor.
- **En los últimos 180 días v2 no mejoró: PF 1,11 contra 1,16.** Con unas 300 operaciones, la diferencia entra en el ruido, pero la mejora no es pareja en todos los tramos.
- Con BTC solo, últimos 180 días: v1 48 operaciones, win rate 31%, PF 1,04; v2 29 operaciones, win rate 45%, PF 1,27 (muestra chica).
- Parte de la suba del win rate es mecánica: una operación que cobra el TP1 y vuelve a la entrada ahora termina en ganancia chica en vez de en pérdida (cerca del 15% de las operaciones de v2 terminan así). Por eso el win rate solo no alcanza: hay que mirar profit factor, expectativa y caída.

### Costos más altos que los medidos

El simulador no incluye deslizamiento. Subiendo el costo total por lado, comisión más deslizamiento (los tres períodos juntos):

| Costo total por lado | v1 PF (expectativa) | v2 PF (expectativa) |
| --- | --- | --- |
| 0,05% (lo medido) | 1,08 (+0,046 R) | 1,18 (+0,091 R) |
| 0,08% | 1,04 (+0,025 R) | 1,15 (+0,076 R) |
| 0,10% | 1,02 (+0,011 R) | 1,13 (+0,066 R) |
| 0,15% | 0,96 (−0,025 R) | 1,08 (+0,042 R) |

Esa es la razón más sólida para v2: más ganancia por operación, así que aguanta mejor un costo que no se midió. El deslizamiento real depende de la moneda, el tamaño y el momento.

## Qué se probó y no se adoptó

Seguir el stop con el TP2, filtros de tendencia (diaria, alineación, media de 200), filtros de RSI, sin cortos, volumen o estructura que no estén en contra, saltear volatilidad expandida, cambiar objetivos o fracciones de salida, horizonte de 96 o 336 h, tope de distancia del stop y confluencia mínima. O no mejoraban en todos los períodos o empeoraban los últimos 180 días.

## Lo que esto no demuestra

- Las reglas se eligieron entre varios cientos de combinaciones mirando los tres períodos: los números de v2 son optimistas por esa selección. Una expectativa razonable es un profit factor de 1,1 a 1,2, no más.
- Son 10 monedas grandes. No se sabe cómo le va a las otras.
- Es el pasado. El control real es el papel hacia adelante, con su muestra (menos de 15 operaciones es «muestra mínima»).
- Sin deslizamiento, sin financiamiento de futuros y con ejecución perfecta al precio del plan.
