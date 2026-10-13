# La mesa con otras velas base (15 min a 12 h)

> Es una medición del pasado: **no garantiza rentabilidad futura y no es asesoramiento financiero.** Las herramientas están en `scripts/investigacion/` (hay un README ahí) y sus tests en `tests/investigacion.test.ts`.

## La pregunta

Se pidió que la mesa «ejecute también en 15 min y demás». Antes de construir nada se midió qué le pasa a la mesa de JARVIS (`lib/jarvis-desk.ts`) cuando la vela base no es la de 1 h de la app, con las dos versiones de reglas: **v1** (las anteriores) y **v2** (las actuales, ver `docs/mesa-reglas-v2.md`).

## Respuesta corta

- **15 min no tiene ventaja medida con comisiones.** Con 0,05% por lado el profit factor es 0,99 (v1) y 1,03 (v2), con intervalos que incluyen 1; con 0,10% por lado pierde con las dos reglas. Con las reglas actuales rinde peor que 1 h: −0,15 de profit factor, intervalo del 90% de −0,31 a −0,01.
- **Las velas más lentas dan mejor profit factor por operación, pero muchas menos operaciones, y el total no sube.** Con las reglas v2 ninguna se distingue de 1 h (todos los intervalos incluyen cero) y el total en R baja de +318 (1 h) a +241 (2 h), +73 (4 h), +69 (6 h) y +20 (12 h).
- **La mejora de v2 sobre v1 se distingue de cero solo con 1 h**: +0,09 de profit factor, intervalo de +0,02 a +0,16. Con 2 h, 4 h, 6 h y 12 h el signo es mixto (con 4 h es negativo) y los intervalos incluyen cero. v2 se diseñó mirando 1 h: ahí la mejora es la menos independiente de todas.
- **Buena parte de lo que se ve en las velas lentas son compras en años alcistas.** Las ventas rinden poco y, con reglas v2, con 12 h perdieron.

Por eso la mesa en vivo, el papel y el backtest de la app siguen con velas de 1 h y no se agregó un selector de velas base.

## Cómo se midió

- **El mismo motor de la app, sin tocarlo**, con el tiempo reescalado («tiempo virtual», explicado en el README de `scripts/investigacion/`): una vela base vale «una hora» para el motor y las velas medias y altas se arman agrupando 4 y 24 velas base, igual que la app arma las de 4 h y 1 d con las de 1 h. Marcos del motor: 15 min → 15 min / 1 h / 6 h; 2 h → 2 h / 8 h / 2 d; 4 h → 4 h / 16 h / 4 d; 6 h → 6 h / 1 d / 6 d; 12 h → 12 h / 2 d / 12 d.
- **Lo que escala solo**: el horizonte (168 velas base: 42 h con 15 min, 84 días con 12 h), el vencimiento de la orden límite (48 velas base) y la cadencia de decisión (cada 4 velas base).
- **Datos**: velas de Binance de BTC, ETH, SOL, BNB, XRP, TRX, DOGE, ZEC, ADA y BCH, de 2021-01 a 2026-09. El dataset de 15 min empieza en 2024-01, así que 15 min se mide de 2024-02 a 2026-09 y se compara con 1 h *en ese mismo período*.
- **Reglas del papel** (iguales en todas): peor caso primero (si una vela toca stop y objetivo, cuenta el stop), una operación a la vez por moneda, comisión por lado y gestión de la operación como en `docs/mesa-reglas-v2.md`.
- **Costos**: 0,05% por lado (el de la tabla principal) y 0,10% por lado (comisión más deslizamiento).
- **Intervalos del 90%**: se remuestrean semanas enteras (500 repeticiones, semilla fija), porque las operaciones de una misma semana, y las de monedas que se mueven juntas, no son independientes. Al comparar dos perfiles (o v1 con v2) se sortean las mismas semanas para los dos.
- **Qué está validado**: el simulador de 1 h reproduce el backtest real de la app (`medir.ts 1h --real BTCUSDT`, ver `docs/mesa-reglas-v2.md`). Los otros perfiles **no tienen contra qué validarse**: la app no corre con otras velas base. Lo que sí está probado es que las lecturas usan solo velas cerradas y que el tiempo virtual alinea los grupos de 4 y 24 velas (tests de `tests/investigacion.test.ts`).

## Resultados

Costo de 0,05% por lado. 2021-01 → 2026-09 (15 min: 2024-02 → 2026-09). Entre corchetes, el intervalo del 90%.

| Velas base | Reglas | Operaciones (por año) | Win rate | Profit factor | Expectativa (R) | Total (R) | Peor caída (R) | PF largos / cortos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15 min | v1 | 10.264 (3.909) | 33% | 0,99 [0,92 a 1,06] | −0,006 | −65 | 236 | 1,01 / 0,97 |
| 15 min | v2 | 6.137 (2.337) | 43% | 1,03 [0,94 a 1,12] | +0,017 | +102 | 136 | 1,09 / 0,97 |
| 1 h | v1 | 6.506 (1.132) | 35% | 1,08 [1,01 a 1,16] | +0,049 | +318 | 133 | 1,14 / 1,03 |
| **1 h** | **v2** | 3.655 (636) | 45% | **1,17 [1,06 a 1,28]** | +0,087 | +318 | 66 | 1,22 / 1,11 |
| 2 h | v1 | 3.655 (636) | 35% | 1,16 [1,04 a 1,27] | +0,092 | +337 | 65 | 1,24 / 1,06 |
| 2 h | v2 | 1.853 (322) | 47% | 1,25 [1,08 a 1,41] | +0,130 | +241 | 52 | 1,33 / 1,16 |
| 4 h | v1 | 2.040 (355) | 35% | 1,23 [1,08 a 1,40] | +0,133 | +271 | 70 | 1,36 / 1,08 |
| 4 h | v2 | 811 (141) | 45% | 1,17 [0,99 a 1,39] | +0,090 | +73 | 41 | 1,26 / 1,07 |
| 6 h | v1 | 1.410 (245) | 36% | 1,29 [1,11 a 1,49] | +0,167 | +236 | 51 | 1,50 / 1,06 |
| 6 h | v2 | 407 (71) | 48% | 1,32 [1,06 a 1,63] | +0,169 | +69 | 19 | 1,62 / 1,04 |
| 12 h | v1 | 657 (114) | 33% | 1,18 [0,95 a 1,42] | +0,107 | +71 | 42 | 1,26 / 1,08 |
| 12 h | v2 | 91 (16) | 52% | 1,46 [0,91 a 2,27] | +0,223 | +20 | 8 | 2,06 / 0,79 |

La fila en negrita es la mesa que corre hoy en la app. Con 91 operaciones en casi seis años, 12 h v2 es muestra chica: el intervalo del profit factor va de 0,91 a 2,27.

### Diferencias entre perfiles (profit factor, intervalo del 90%)

Si el intervalo incluye cero, **no se puede decir que sean distintos**.

| Comparación | 2021-01 → 2026-09 | 2024-02 → 2026-09 |
| --- | --- | --- |
| 15 min: v2 − v1 | — | +0,04 [−0,01 a +0,08] |
| 1 h: v2 − v1 | **+0,09 [+0,02 a +0,16]** | **+0,11 [+0,02 a +0,21]** |
| 2 h: v2 − v1 | +0,09 [−0,01 a +0,22] | +0,05 [−0,09 a +0,21] |
| 4 h: v2 − v1 | −0,06 [−0,23 a +0,11] | −0,14 [−0,33 a +0,08] |
| 6 h: v2 − v1 | +0,03 [−0,23 a +0,29] | +0,01 [−0,33 a +0,40] |
| 12 h: v2 − v1 | +0,27 [−0,28 a +1,16] | +0,17 [−0,67 a +1,52] |
| 15 min − 1 h, reglas v1 | — | −0,08 [−0,17 a +0,01] |
| 15 min − 1 h, reglas v2 | — | **−0,15 [−0,31 a −0,01]** |
| 2 h − 1 h, reglas v1 | +0,07 [−0,00 a +0,15] | +0,02 [−0,07 a +0,12] |
| 4 h − 1 h, reglas v1 | **+0,15 [+0,03 a +0,28]** | +0,15 [−0,04 a +0,36] |
| 6 h − 1 h, reglas v1 | **+0,21 [+0,06 a +0,37]** | +0,21 [−0,02 a +0,47] |
| 12 h − 1 h, reglas v1 | +0,10 [−0,12 a +0,36] | +0,24 [−0,06 a +0,63] |
| 2 h − 1 h, reglas v2 | +0,08 [−0,02 a +0,21] | −0,04 [−0,19 a +0,13] |
| 4 h − 1 h, reglas v2 | −0,00 [−0,18 a +0,19] | −0,10 [−0,29 a +0,13] |
| 6 h − 1 h, reglas v2 | +0,16 [−0,12 a +0,44] | +0,12 [−0,24 a +0,58] |
| 12 h − 1 h, reglas v2 | +0,29 [−0,26 a +1,14] | +0,30 [−0,46 a +1,45] |

En negrita, las únicas diferencias cuyo intervalo no incluye cero. Son 5 de 29: dos a favor de 4 h y 6 h sobre 1 h con reglas v1, dos que son la misma comparación (v2 contra v1 con 1 h) en los dos períodos, que se solapan, y una contra 15 min con v2. Mirando tantas comparaciones, alguna aparece por azar.

### Cuánto se lleva el costo

2024-02 → 2026-09, para comparar con 15 min. «Costo de 0,05% por lado» es lo que ese costo le resta a cada operación, en R.

| Velas base | Reglas | Expectativa sin costos (R) | Costo de 0,05% por lado (R por operación) | Expectativa con 0,05% | Profit factor con 0,05% / 0,10% | Total (R) con 0,05% / 0,10% |
| --- | --- | --- | --- | --- | --- | --- |
| 15 min | v1 | +0,078 | 0,085 | −0,006 | 0,99 / 0,87 | −65 / −933 |
| 15 min | v2 | +0,072 | 0,056 | +0,017 | 1,03 / 0,93 | +102 / −241 |
| 1 h | v1 | +0,081 | 0,040 | +0,042 | 1,07 / 1,00 | +120 / +6 |
| 1 h | v2 | +0,121 | 0,026 | +0,095 | 1,18 / 1,13 | +158 / +114 |
| 2 h | v1 | +0,082 | 0,028 | +0,054 | 1,09 / 1,04 | +88 / +43 |
| 2 h | v2 | +0,096 | 0,019 | +0,076 | 1,14 / 1,10 | +66 / +49 |
| 4 h | v1 | +0,145 | 0,020 | +0,125 | 1,22 / 1,18 | +112 / +94 |
| 4 h | v2 | +0,061 | 0,016 | +0,045 | 1,08 / 1,05 | +18 / +12 |
| 6 h | v1 | +0,182 | 0,018 | +0,164 | 1,28 / 1,25 | +107 / +96 |
| 6 h | v2 | +0,170 | 0,014 | +0,156 | 1,30 / 1,27 | +32 / +29 |
| 12 h | v1 | +0,186 | 0,014 | +0,172 | 1,31 / 1,28 | +52 / +48 |
| 12 h | v2 | +0,267 | 0,012 | +0,254 | 1,48 / 1,45 | +14 / +13 |

## Lectura

**15 min es un problema de costos más que de señal.** Con las reglas v1, antes de costos cada operación vale lo mismo con 15 min (+0,078 R), 1 h (+0,081 R) y 2 h (+0,082 R). Lo que cambia es el tamaño del stop en precio: con velas de 15 min es chico, y los mismos 0,05% por lado se llevan 0,085 R por operación (0,040 R con 1 h, 0,014 R con 12 h). Con 15 min la mesa opera unas 2.300 a 3.900 veces por año en 10 monedas, y el costo se come lo que la señal deja. No se midió con órdenes *maker* (comisión menor): las entradas límite se llenan con sesgo, cuando el precio ya fue en contra, y los stops salen a mercado, así que no alcanza con restar comisión.

**Más lento mejora la calidad media, no el total.** Con v1, el profit factor sube de 1,08 (1 h) a 1,16 / 1,23 / 1,29 (2 h / 4 h / 6 h), y esa diferencia con 1 h es distinguible de cero en el período largo para 4 h y 6 h. Pero a la vez hay 1.132 / 636 / 355 / 245 operaciones por año y el total en R no sube (+318 / +337 / +271 / +236). Con v2 la tabla de diferencias no deja afirmar ninguna mejora respecto de 1 h. Una vela más lenta no es «mejor»: es otra mesa que opera mucho menos y con mejor promedio.

**Las reglas v2 ayudan donde se diseñaron.** v2 reduce las operaciones entre 40% (15 min) y 86% (12 h), sube el win rate (de 33–36% a 43–52%) y baja la peor caída. Su mejora de profit factor se distingue de cero con 1 h. Con 2 h, 6 h y 12 h es positiva pero con intervalos que incluyen cero, y con 4 h es negativa (−0,06 [−0,23 a +0,11]). Probar las mismas reglas en otras velas no es una prueba independiente (son los mismos precios), pero tampoco las refuerza.

**La ventaja está en las compras.** Con v2, el profit factor de largos / cortos es 1,22 / 1,11 (1 h), 1,33 / 1,16 (2 h), 1,26 / 1,07 (4 h), 1,62 / 1,04 (6 h) y 2,06 / 0,79 (12 h): cuanto más lenta la vela, más se apoya en las compras. Son diez monedas que hoy siguen entre las más grandes: ese filtro de supervivencia favorece a los largos del pasado. Los cortos con v2 y 6 h o 12 h (1,04 y 0,79) no tienen ventaja medida.

**Los años importan.** Con v2, 1 h y 2 h tienen profit factor mayor que 1 en los seis años (1 h: 1,35 / 1,11 / 1,03 / 1,32 / 1,07 / 1,14 de 2021 a 2026; 2 h: 1,92 / 1,28 / 1,06 / 1,16 / 1,10 / 1,16) y 6 h también, pero 4 h cae a 0,95 en 2023. Con v1 hubo años en contra con casi todas las velas (por ejemplo 1 h en 2023: 0,96 y en 2025: 0,97; 6 h en 2022: 0,91). La tabla completa, abajo, tiene el detalle por año; las celdas con menos de 15 operaciones dicen «—» (muestra mínima).

**2 h con v2 es el candidato más tentador, y no se distingue de 1 h.** Profit factor 1,25 contra 1,17, peor caída de 52 R contra 66 R, mayor que 1 todos los años. Pero la diferencia es +0,08 [−0,02 a +0,21] en el período largo y −0,04 [−0,19 a +0,13] en el corto, y el total en R es menor (+241 contra +318). No hay base para cambiar.

## Qué se decidió

1. La mesa en vivo, el papel y el backtest de la app siguen con velas de 1 h. No hay selector de velas base en la mesa.
2. 15 min no se agrega: la medición no muestra ventaja con comisiones y empeoraría con deslizamiento.
3. Probar otra vela base en la app exigiría lo mismo que cualquier regla (objetivo «jarvis» en `docs/araña/objetivos.md`): medirla en los tres períodos, con costos más altos, decir lo que no mejoró y, además, acumular papel hacia adelante con esa vela. Las herramientas para volver a medir están en `scripts/investigacion/` (`perfiles.ts`, `perfiles.ts --intervalos`).

## Lo que esto no demuestra

- **Selección.** Se miraron 6 velas × 2 reglas × 2 costos × 2 períodos y se comentan las filas que se destacan. Cada intervalo del 90% no corrige por haber mirado muchas filas: con 29 comparaciones, algunas «distinguibles» salen por azar.
- **Supervivencia y correlación.** Diez monedas grandes de hoy, no un universo; y en la mesa de 1 h hay en promedio 6 o 7 posiciones abiertas a la vez (ver `docs/mesa-reglas-v2.md`), así que diez monedas no son diez pruebas independientes.
- **El tiempo virtual escala el motor, no lo reajusta.** Los umbrales y multiplicadores del motor están pensados para 1 h / 4 h / 1 d. Un motor ajustado a cada vela podría rendir distinto, mejor o peor una vez ajustado (y entonces habría que medirlo fuera de muestra).
- **Ejecución perfecta.** Sin deslizamiento ni latencia (pesarían más con 15 min), sin financiamiento de futuros y con ejecución al precio del plan.
- **Sin derivados, noticias ni calendario históricos.** Esos especialistas pesan cero en la medición; en vivo sí leen, así que lo medido no es exactamente lo que ve la persona.
- **El pasado no garantiza el futuro.** El control que importa es el papel hacia adelante.

## Tabla completa

Costos de 0,05% y 0,10% por lado, y los dos períodos. «—» = menos de 15 operaciones (muestra mínima). `PF por año`: profit factor de cada año calendario (2021 y 2026 incompletos). Se regenera con `node --experimental-strip-types scripts/investigacion/perfiles.ts`.

<details>
<summary>Ver las 44 filas</summary>

| Velas base | Período | Reglas | Costo por lado | Operaciones | Win rate | Profit factor | Expectativa (R) | Total (R) | Peor caída (R) | PF largos / cortos | PF por año |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15m | 2024-02 → 2026-09 | v1 | 0,05% | 10.264 (3.909/año) | 33% | 0,99 | −0,006 | −65 | 236 | 1,01 / 0,97 | 24: 1,02 · 25: 0,97 · 26: 0,98 |
| 15m | 2024-02 → 2026-09 | v1 | 0,10% | 10.264 (3.909/año) | 33% | 0,87 | −0,091 | −933 | 971 | 0,89 / 0,86 | 24: 0,91 · 25: 0,86 · 26: 0,85 |
| 15m | 2024-02 → 2026-09 | v2 | 0,05% | 6.137 (2.337/año) | 43% | 1,03 | +0,017 | +102 | 136 | 1,09 / 0,97 | 24: 1,06 · 25: 0,98 · 26: 1,07 |
| 15m | 2024-02 → 2026-09 | v2 | 0,10% | 6.137 (2.337/año) | 42% | 0,93 | −0,039 | −241 | 287 | 0,98 / 0,89 | 24: 0,97 · 25: 0,89 · 26: 0,95 |
| 1h | 2021-01 → 2026-09 | v1 | 0,05% | 6.506 (1.132/año) | 35% | 1,08 | +0,049 | +318 | 133 | 1,14 / 1,03 | 21: 1,26 · 22: 1,03 · 23: 0,96 · 24: 1,11 · 25: 0,97 · 26: 1,16 |
| 1h | 2021-01 → 2026-09 | v1 | 0,10% | 6.506 (1.132/año) | 34% | 1,02 | +0,013 | +86 | 225 | 1,07 / 0,97 | 21: 1,22 · 22: 0,98 · 23: 0,90 · 24: 1,05 · 25: 0,92 · 26: 1,08 |
| 1h | 2021-01 → 2026-09 | v2 | 0,05% | 3.655 (636/año) | 45% | 1,17 | +0,087 | +318 | 66 | 1,22 / 1,11 | 21: 1,35 · 22: 1,11 · 23: 1,03 · 24: 1,32 · 25: 1,07 · 26: 1,14 |
| 1h | 2021-01 → 2026-09 | v2 | 0,10% | 3.655 (636/año) | 45% | 1,12 | +0,063 | +230 | 86 | 1,17 / 1,06 | 21: 1,31 · 22: 1,07 · 23: 0,97 · 24: 1,26 · 25: 1,03 · 26: 1,08 |
| 1h | 2024-02 → 2026-09 | v1 | 0,05% | 2.887 (1.100/año) | 34% | 1,07 | +0,042 | +120 | 84 | 1,15 / 0,99 | 24: 1,11 · 25: 0,97 · 26: 1,16 |
| 1h | 2024-02 → 2026-09 | v1 | 0,10% | 2.887 (1.100/año) | 34% | 1,00 | +0,002 | +6 | 109 | 1,07 / 0,93 | 24: 1,05 · 25: 0,92 · 26: 1,08 |
| 1h | 2024-02 → 2026-09 | v2 | 0,05% | 1.674 (638/año) | 45% | 1,18 | +0,095 | +158 | 50 | 1,29 / 1,08 | 24: 1,36 · 25: 1,07 · 26: 1,14 |
| 1h | 2024-02 → 2026-09 | v2 | 0,10% | 1.674 (638/año) | 45% | 1,13 | +0,068 | +114 | 56 | 1,23 / 1,03 | 24: 1,31 · 25: 1,03 · 26: 1,08 |
| 2h | 2021-01 → 2026-09 | v1 | 0,05% | 3.655 (636/año) | 35% | 1,16 | +0,092 | +337 | 65 | 1,24 / 1,06 | 21: 1,37 · 22: 1,15 · 23: 1,09 · 24: 1,19 · 25: 0,97 · 26: 1,18 |
| 2h | 2021-01 → 2026-09 | v1 | 0,10% | 3.655 (636/año) | 35% | 1,11 | +0,067 | +243 | 74 | 1,19 / 1,02 | 21: 1,33 · 22: 1,10 · 23: 1,04 · 24: 1,14 · 25: 0,93 · 26: 1,11 |
| 2h | 2021-01 → 2026-09 | v2 | 0,05% | 1.853 (322/año) | 47% | 1,25 | +0,130 | +241 | 52 | 1,33 / 1,16 | 21: 1,92 · 22: 1,28 · 23: 1,06 · 24: 1,16 · 25: 1,10 · 26: 1,16 |
| 2h | 2021-01 → 2026-09 | v2 | 0,10% | 1.853 (322/año) | 47% | 1,21 | +0,112 | +208 | 59 | 1,29 / 1,12 | 21: 1,88 · 22: 1,25 · 23: 1,02 · 24: 1,12 · 25: 1,07 · 26: 1,12 |
| 2h | 2024-02 → 2026-09 | v1 | 0,05% | 1.640 (625/año) | 34% | 1,09 | +0,054 | +88 | 65 | 1,20 / 0,98 | 24: 1,18 · 25: 0,97 · 26: 1,18 |
| 2h | 2024-02 → 2026-09 | v1 | 0,10% | 1.640 (625/año) | 33% | 1,04 | +0,026 | +43 | 74 | 1,14 / 0,94 | 24: 1,13 · 25: 0,93 · 26: 1,11 |
| 2h | 2024-02 → 2026-09 | v2 | 0,05% | 868 (331/año) | 45% | 1,14 | +0,076 | +66 | 30 | 1,22 / 1,06 | 24: 1,17 · 25: 1,10 · 26: 1,16 |
| 2h | 2024-02 → 2026-09 | v2 | 0,10% | 868 (331/año) | 45% | 1,10 | +0,057 | +49 | 33 | 1,18 / 1,03 | 24: 1,14 · 25: 1,07 · 26: 1,12 |
| 4h | 2021-01 → 2026-09 | v1 | 0,05% | 2.040 (355/año) | 35% | 1,23 | +0,133 | +271 | 70 | 1,36 / 1,08 | 21: 1,77 · 22: 1,01 · 23: 1,02 · 24: 1,06 · 25: 1,19 · 26: 1,54 |
| 4h | 2021-01 → 2026-09 | v1 | 0,10% | 2.040 (355/año) | 35% | 1,19 | +0,114 | +232 | 80 | 1,32 / 1,05 | 21: 1,73 · 22: 0,98 · 23: 0,99 · 24: 1,03 · 25: 1,16 · 26: 1,48 |
| 4h | 2021-01 → 2026-09 | v2 | 0,05% | 811 (141/año) | 45% | 1,17 | +0,090 | +73 | 41 | 1,26 / 1,07 | 21: 1,74 · 22: 1,32 · 23: 0,95 · 24: 1,06 · 25: 1,15 · 26: 1,07 |
| 4h | 2021-01 → 2026-09 | v2 | 0,10% | 811 (141/año) | 45% | 1,14 | +0,076 | +61 | 44 | 1,22 / 1,04 | 21: 1,71 · 22: 1,29 · 23: 0,93 · 24: 1,04 · 25: 1,12 · 26: 1,03 |
| 4h | 2024-02 → 2026-09 | v1 | 0,05% | 899 (342/año) | 35% | 1,22 | +0,125 | +112 | 47 | 1,28 / 1,14 | 24: 1,05 · 25: 1,19 · 26: 1,54 |
| 4h | 2024-02 → 2026-09 | v1 | 0,10% | 899 (342/año) | 35% | 1,18 | +0,104 | +94 | 52 | 1,24 / 1,11 | 24: 1,02 · 25: 1,16 · 26: 1,48 |
| 4h | 2024-02 → 2026-09 | v2 | 0,05% | 401 (153/año) | 42% | 1,08 | +0,045 | +18 | 27 | 1,18 / 0,95 | 24: 1,02 · 25: 1,15 · 26: 1,07 |
| 4h | 2024-02 → 2026-09 | v2 | 0,10% | 401 (153/año) | 42% | 1,05 | +0,030 | +12 | 29 | 1,14 / 0,93 | 24: 1,00 · 25: 1,12 · 26: 1,03 |
| 6h | 2021-01 → 2026-09 | v1 | 0,05% | 1.410 (245/año) | 36% | 1,29 | +0,167 | +236 | 51 | 1,50 / 1,06 | 21: 1,76 · 22: 0,91 · 23: 1,20 · 24: 1,23 · 25: 1,20 · 26: 1,60 |
| 6h | 2021-01 → 2026-09 | v1 | 0,10% | 1.410 (245/año) | 36% | 1,26 | +0,151 | +213 | 54 | 1,46 / 1,03 | 21: 1,72 · 22: 0,89 · 23: 1,16 · 24: 1,20 · 25: 1,17 · 26: 1,55 |
| 6h | 2021-01 → 2026-09 | v2 | 0,05% | 407 (71/año) | 48% | 1,32 | +0,169 | +69 | 19 | 1,62 / 1,04 | 21: 2,27 · 22: 1,12 · 23: 1,24 · 24: 1,29 · 25: 1,34 · 26: 1,34 |
| 6h | 2021-01 → 2026-09 | v2 | 0,10% | 407 (71/año) | 48% | 1,29 | +0,155 | +63 | 20 | 1,58 / 1,01 | 21: 2,23 · 22: 1,10 · 23: 1,21 · 24: 1,26 · 25: 1,31 · 26: 1,31 |
| 6h | 2024-02 → 2026-09 | v1 | 0,05% | 654 (249/año) | 36% | 1,28 | +0,164 | +107 | 29 | 1,34 / 1,21 | 24: 1,18 · 25: 1,20 · 26: 1,60 |
| 6h | 2024-02 → 2026-09 | v1 | 0,10% | 654 (249/año) | 36% | 1,25 | +0,146 | +96 | 32 | 1,30 / 1,18 | 24: 1,15 · 25: 1,17 · 26: 1,55 |
| 6h | 2024-02 → 2026-09 | v2 | 0,05% | 205 (78/año) | 47% | 1,30 | +0,156 | +32 | 18 | 1,61 / 0,89 | 24: 1,23 · 25: 1,34 · 26: 1,34 |
| 6h | 2024-02 → 2026-09 | v2 | 0,10% | 205 (78/año) | 47% | 1,27 | +0,142 | +29 | 18 | 1,57 / 0,87 | 24: 1,20 · 25: 1,31 · 26: 1,31 |
| 12h | 2021-01 → 2026-09 | v1 | 0,05% | 657 (114/año) | 33% | 1,18 | +0,107 | +71 | 42 | 1,26 / 1,08 | 21: 1,25 · 22: 0,99 · 23: 1,04 · 24: 1,32 · 25: 1,34 · 26: 1,26 |
| 12h | 2021-01 → 2026-09 | v1 | 0,10% | 657 (114/año) | 33% | 1,16 | +0,094 | +62 | 45 | 1,23 / 1,06 | 21: 1,23 · 22: 0,97 · 23: 1,01 · 24: 1,29 · 25: 1,31 · 26: 1,23 |
| 12h | 2021-01 → 2026-09 | v2 | 0,05% | 91 (16/año) | 52% | 1,46 | +0,223 | +20 | 8 | 2,06 / 0,79 | 21: — · 22: — · 23: 1,45 · 24: 1,73 · 25: 1,49 · 26: — |
| 12h | 2021-01 → 2026-09 | v2 | 0,10% | 91 (16/año) | 52% | 1,43 | +0,211 | +19 | 8 | 2,02 / 0,77 | 21: — · 22: — · 23: 1,42 · 24: 1,70 · 25: 1,46 · 26: — |
| 12h | 2024-02 → 2026-09 | v1 | 0,05% | 300 (114/año) | 36% | 1,31 | +0,172 | +52 | 24 | 1,40 / 1,15 | 24: 1,31 · 25: 1,34 · 26: 1,26 |
| 12h | 2024-02 → 2026-09 | v1 | 0,10% | 300 (114/año) | 36% | 1,28 | +0,159 | +48 | 24 | 1,37 / 1,12 | 24: 1,29 · 25: 1,31 · 26: 1,23 |
| 12h | 2024-02 → 2026-09 | v2 | 0,05% | 54 (21/año) | 48% | 1,48 | +0,254 | +14 | 8 | 2,11 / 0,65 | 24: 1,84 · 25: 1,49 · 26: — |
| 12h | 2024-02 → 2026-09 | v2 | 0,10% | 54 (21/año) | 48% | 1,45 | +0,242 | +13 | 8 | 2,07 / 0,63 | 24: 1,80 · 25: 1,46 · 26: — |

</details>
