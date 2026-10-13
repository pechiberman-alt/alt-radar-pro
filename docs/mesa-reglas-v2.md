# La mesa de JARVIS: reglas v2

Qué cambió respecto de la versión anterior, cómo se midió y qué no demuestra.
Es una medición del pasado, simulada: **no garantiza rentabilidad futura y no es asesoramiento financiero.**

Documentos hermanos: `docs/mesa-perfiles.md` (la mesa con otras velas base) y `docs/mesa-aprendizaje.md` (si un modelo puede aprender de las operaciones pasadas). Todo se reproduce con `scripts/investigacion/` (ver su `README.md`).

## Qué cambió

| Regla | v1 | v2 |
| --- | --- | --- |
| Margen del stop detrás del nivel que lo defiende | 0,25 ATR de 4 h | 1 ATR de 4 h |
| Consenso mínimo para tomar un lado | ±0,15 | ±0,30 (el veto «va en contra de este lado» sigue desde ±0,15) |
| Stop al cobrar el TP1 | fijo | pasa a la entrada |

Cuando la vela que cobra el TP1 también toca la entrada, no se sabe qué pasó primero: se cuenta el peor caso, y el resto sale en la entrada (igual que si una vela toca stop y objetivo, cuenta el stop).

Cada operación de papel guarda con qué reglas se abrió (`reglas`, `gestion`). Las que se abrieron antes de v2 siguen con el stop fijo: el plan que mostró la tarjeta no se edita después. El código está en `lib/jarvis-desk.ts` (constantes `DESK_RULES`, `STOP_BUFFER_ATR`, `CONSENSUS_EDGE`) y `lib/jarvis-paper.ts` (salida `BE`); los tests, en `tests/jarvis-rules-v2.test.ts`.

## Cómo se midió

- La misma mesa y las mismas reglas del papel que usa la app (`lib/jarvis-backtest.ts`): una operación a la vez por moneda, decisión en cada cierre de 4 h con solo velas ya cerradas, comisión de 0,05% por lado, peor caso primero.
- 10 monedas grandes y líquidas (BTC, ETH, SOL, BNB, XRP, TRX, DOGE, ZEC, ADA, BCH) con velas de Binance de 1 h, 4 h y 1 d hasta el 30/09/2026.
- Tres períodos que no se superponen: 2021-01 → 2024-02, 2024-02 → 2025-06 y 2025-07 → 2026-09, más los últimos 180 días (que están dentro del tercero).
- Sin derivados, noticias ni calendario históricos: esos especialistas pesan cero en el backtest (en vivo sí leen).
- Los números salen del simulador de `scripts/investigacion/`, que repite las decisiones de la mesa sobre lo que cada especialista veía en cada cierre. Se validó contra el backtest real de la app, operación por operación: con las reglas v2 (versión actual) difieren 4 de 3.662 operaciones, y con las v1 (la versión anterior de la app, commit 7928f00) 37 de 6.513 (0,6%); la suma de R coincide (v2: +320 R los dos; v1: +314 R el simulador contra +316 R la app). Si cambia el motor, hay que volver a validarlo (`medir.ts 1h --real BTCUSDT`).
- Una versión anterior de ese simulador tomaba órdenes límite que la mesa real nunca toma (cuando otro veto frena el plan a mercado, la mesa no prueba la orden límite). Con las reglas v2, donde el stop está más lejos y ese veto se activa más seguido, eso sobrestimaba v2 de forma leve: se corrigió y los números de este documento son los corregidos.

## Resultados (10 monedas, comisión 0,05% por lado, una operación a la vez)

| Período | Reglas | Operaciones | Win rate | Profit factor | Expectativa | Total | Peor caída | Monedas con PF > 1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2021-01 → 2024-02 | v1 | 3.622 | 35% | 1,09 | +0,055 R | +198 R | 133 R | 7 de 10 |
| | v2 | 1.984 | 45% | 1,16 | +0,082 R | +162 R | 66 R | 9 de 10 |
| 2024-02 → 2025-06 | v1 | 1.530 | 33% | 1,02 | +0,013 R | +19 R | 84 R | 4 de 10 |
| | v2 | 900 | 45% | 1,15 | +0,077 R | +69 R | 47 R | 10 de 10 |
| 2025-07 → 2026-09 | v1 | 1.362 | 36% | 1,12 | +0,071 R | +96 R | 70 R | 9 de 10 |
| | v2 | 778 | 46% | 1,22 | +0,115 R | +89 R | 50 R | 7 de 10 |
| Últimos 180 días | v1 | 518 | 37% | 1,15 | +0,091 R | +47 R | 30 R | 8 de 10 |
| | v2 | 305 | 44% | 1,10 | +0,058 R | +18 R | 28 R | 6 de 10 |

La peor caída es la de la suma de R de las 10 monedas, ordenadas por fecha de cierre.

Lo que dicen los números:

- v2 mejora el win rate, el profit factor y la peor caída en los tres períodos largos (profit factor +0,07, +0,13 y +0,10). Opera casi la mitad y el total en R es parecido, no mayor (+314 R contra +320 R entre los tres).
- **En los últimos 180 días v2 no mejoró: profit factor 1,10 contra 1,15.** Con unas 300 operaciones la diferencia entra en el ruido, pero la mejora no es pareja en todos los tramos.
- Con BTC solo, últimos 180 días: v1 48 operaciones, win rate 31%, PF 1,04; v2 29 operaciones, win rate 45%, PF 1,27 (muestra chica).
- Parte de la suba del win rate es mecánica: una operación que cobra el TP1 y vuelve a la entrada ahora termina en ganancia chica en vez de en pérdida (cerca del 15% de las operaciones de v2 terminan así). Por eso el win rate solo no alcanza: hay que mirar profit factor, expectativa y caída.
- Empezar a contar unas horas más tarde no cambia el resultado (`medir.ts 1h --fases`, 12 comienzos distintos): v1 PF 1,08 en todos, v2 entre 1,16 y 1,17. Lo que sí mueve las cifras es cómo se cortan las ventanas: unos ±0,05 de profit factor.

### De dónde sale el resultado

Todas las operaciones de v2, de 2021 a 2026 (3.655):

| Cómo terminó | Operaciones | Resultado medio |
| --- | --- | --- |
| Stop | 1.780 (49%) | −1,03 R |
| Pasaron 7 días sin tocar un objetivo | 479 (13%) | +0,13 R |
| Cobró el TP1 y volvió a la entrada | 447 (12%) | +0,43 R |
| Cobró el TP1 y pasaron los 7 días | 233 (6%) | +1,35 R |
| Cobró TP1 y TP2 y volvió a la entrada | 96 (3%) | +1,25 R |
| Cobró TP1 y TP2 y pasaron los 7 días | 175 (5%) | +1,88 R |
| Llegó a los tres objetivos | 445 (12%) | +2,53 R |

Casi la mitad termina en stop; la ganancia viene de la minoría que llega lejos.

Por año, profit factor de v2 contra v1 (2026 llega hasta septiembre): 2021 1,35 / 1,26; 2022 1,11 / 1,03; 2023 1,03 / 0,96; 2024 1,32 / 1,11; 2025 1,07 / 0,97; 2026 1,14 / 1,16. v2 queda por encima de 1 los seis años; v1 queda por debajo en 2023 y 2025. Los largos de v2 tienen PF 1,22 (+217 R) y los cortos 1,11 (+101 R). Por moneda, v2 tiene PF mayor a 1 en 9 de 10 (XRP: 0,94).

### Otra forma de contar: todos los puntos de decisión

La tabla de arriba toma la primera señal después de cerrar la operación anterior. Esta cuenta cada punto de decisión con plan aprobado, aunque haya otra operación abierta (`medir.ts 1h --densa`). Los puntos se solapan en el tiempo (una misma señal se repite en lecturas seguidas) y las monedas se mueven juntas: **no son independientes y su cantidad no les da el peso estadístico que parece.**

| Período | Reglas | Puntos de decisión | Win rate | Profit factor | Expectativa |
| --- | --- | --- | --- | --- | --- |
| 2021-01 → 2024-02 | v1 | 40.271 | 34% | 1,07 | +0,045 R |
| | v2 | 15.169 | 45% | 1,16 | +0,086 R |
| 2024-02 → 2025-06 | v1 | 17.641 | 32% | 0,94 | −0,036 R |
| | v2 | 6.695 | 41% | 0,93 | −0,037 R |
| 2025-07 → 2026-09 | v1 | 15.584 | 36% | 1,12 | +0,072 R |
| | v2 | 6.104 | 45% | 1,16 | +0,083 R |
| Últimos 180 días | v1 | 6.007 | 33% | 0,92 | −0,048 R |
| | v2 | 2.304 | 41% | 1,00 | +0,001 R |

Contado así, v2 es mejor o igual que v1 en tres de los cuatro tramos y en el cuarto (2024-02 → 2025-06) las dos reglas quedan apenas por debajo de cero. Ese tramo es el que más cambia con la forma de contar: profit factor 1,15 con una operación a la vez y 0,93 con todos los puntos. La conclusión honesta es que **la mejora de v2 existe, pero es menor y menos pareja de lo que muestra la tabla de una operación a la vez**, y que en 2024-02 → 2025-06 la mesa no mostró una ventaja que resista otra manera de medir.

### Costos más altos que los medidos

El simulador no incluye deslizamiento. Subiendo el costo total por lado, comisión más deslizamiento (los tres períodos juntos, `medir.ts 1h --costos`):

| Costo total por lado | v1 PF (expectativa) | v2 PF (expectativa) |
| --- | --- | --- |
| 0,05% (lo medido) | 1,08 (+0,048 R) | 1,17 (+0,087 R) |
| 0,08% | 1,04 (+0,027 R) | 1,14 (+0,073 R) |
| 0,10% | 1,02 (+0,012 R) | 1,12 (+0,063 R) |
| 0,15% | 0,96 (−0,023 R) | 1,07 (+0,039 R) |

Esa es la razón más sólida para v2: más ganancia por operación, así que aguanta mejor un costo que no se midió. El deslizamiento real depende de la moneda, el tamaño y el momento.

## Qué se probó y no se adoptó

Cambios a v2, uno por vez, con el profit factor de cada ventana (`medir.ts 1h --variantes`). Es una muestra reproducible de las pruebas; en total se probaron varios cientos de combinaciones. Se consideró que un cambio mejora solo si sube el profit factor más de 0,05 en las cuatro ventanas, porque menos que eso no se distingue del ruido de cómo se cortan.

| Cambio | 2021-01 → 2024-02 | 2024-02 → 2025-06 | 2025-07 → 2026-09 | Últimos 180 días | Operaciones | R total |
| --- | --- | --- | --- | --- | --- | --- |
| **v2 (las reglas de la app)** | 1,16 | 1,15 | 1,22 | 1,10 | 3.662 | +320 |
| El stop sigue al TP2 | 1,14 | 1,13 | 1,26 | 1,15 | 3.783 | +316 |
| Tendencia diaria a favor | 1,19 | 0,97 | 1,20 | 1,15 | 2.363 | +170 |
| Tendencia diaria no en contra | 1,17 | 1,14 | 1,20 | 1,11 | 3.567 | +310 |
| Marcos alineados a favor | 1,12 | 1,14 | 1,17 | 1,11 | 3.025 | +219 |
| Precio del lado de la media de 200 | 1,17 | 1,01 | 1,19 | 1,15 | 2.685 | +188 |
| RSI de 4 h: sin largos sobre 70 ni cortos bajo 30 | 1,16 | 1,12 | 1,14 | 0,94 | 3.389 | +257 |
| **Sin cortos** | 1,18 | 1,23 | 1,33 | 1,34 | 1.885 | +215 |
| Volumen no en contra | 1,17 | 1,15 | 1,21 | 1,10 | 3.448 | +308 |
| Estructura no en contra | 1,16 | 1,15 | 1,22 | 1,10 | 3.662 | +320 |
| Sin volatilidad expandida | 1,14 | 1,17 | 1,18 | 1,02 | 3.501 | +283 |
| Objetivos a 1 / 2 / 3 R | 1,14 | 1,12 | 1,17 | 1,04 | 3.820 | +269 |
| Objetivos a 2 / 3 / 4 R | 1,16 | 1,15 | 1,22 | 1,10 | 3.589 | +327 |
| Salidas 50 / 25 / 25 | 1,14 | 1,15 | 1,18 | 1,09 | 3.645 | +287 |
| Salidas 25 / 25 / 50 | 1,17 | 1,16 | 1,24 | 1,12 | 3.666 | +344 |
| Horizonte de 96 horas | 1,14 | 1,14 | 1,15 | 1,01 | 4.499 | +300 |
| Horizonte de 336 horas | 1,16 | 1,17 | 1,16 | 1,03 | 3.090 | +277 |
| Stop de hasta 2,5 ATR | 1,10 | 1,14 | 1,19 | 1,06 | 3.584 | +248 |
| Confluencia mínima de 50 | 1,15 | 1,14 | 1,22 | 1,10 | 3.645 | +307 |
| Consenso menor a 0,60 | 1,16 | 1,15 | 1,22 | 1,10 | 3.660 | +320 |
| TP1 a 1,3 R o más | 1,14 | 1,18 | 1,20 | 1,15 | 3.352 | +291 |
| TP1 a 1,5 R o más | 1,17 | 1,12 | 1,16 | 1,15 | 3.030 | +259 |

Ningún cambio sube el profit factor más de 0,05 en las cuatro ventanas. Dos suben un poco en todas (salidas 25 / 25 / 50, de +0,01 a +0,02, y sin cortos) y el resto empeora en alguna.

**Sin cortos** es el candidato más fuerte y la decisión más discutible: sube el profit factor en las cuatro ventanas (+0,02, +0,08, +0,11 y +0,24), pero en la primera la suba es ruido, y a cambio se pierde un tercio del resultado total (+215 R contra +320 R) y casi la mitad de las operaciones. Los cortos de v2 ganaron en cinco de los seis años (en 2022, PF 1,38 y +74 R, cuando los largos perdieron 36 R) y sin ellos la mesa depende de que el mercado suba. No se adoptó. Quien prefiera un perfil de largos solamente tiene en esta tabla lo que cuesta y lo que gana.

Lo que sí es parejo en los tres períodos, pero en muy pocas operaciones: las que van **contra la tendencia diaria** tienen profit factor 0,59, 0,75 y 0,60 (542 de 27.968 puntos), y las que van contra la tendencia de BTC en 4 h, 0,65, 0,90 y 0,88 (`aprendizaje.ts --cortes`). Excluir las de la tendencia diaria («Tendencia diaria no en contra») no cambió el resultado: son pocas.

## Lo que esto no demuestra

- Las reglas se eligieron entre varios cientos de combinaciones mirando los tres períodos: los números de v2 son optimistas por esa selección. Una expectativa razonable es un profit factor de 1,1 a 1,2, no más.
- Son 10 monedas grandes y de hoy: las que siguen vivas y grandes (sesgo de supervivencia). No se sabe cómo le va a las otras ni cómo le habría ido a las que desaparecieron.
- Las posiciones de las 10 monedas están muy correlacionadas (en promedio hay 6 o 7 de las 10 abiertas a la vez): diez monedas no son diez pruebas independientes.
- El resultado depende de cómo se cuente: con una operación a la vez, v2 tiene PF 1,15 en 2024-02 → 2025-06; contando todos los puntos de decisión, 0,93.
- Es el pasado. El control real es el papel hacia adelante, con su muestra (menos de 15 operaciones es «muestra mínima»).
- Sin deslizamiento, sin financiamiento de futuros y con ejecución perfecta al precio del plan.
- Sin derivados, noticias ni calendario históricos: en vivo esos especialistas leen y pueden cambiar una decisión que el backtest no vio.
