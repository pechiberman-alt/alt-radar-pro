# ¿Puede la mesa aprender de sus propias operaciones?

> Es una medición del pasado: **no garantiza rentabilidad futura y no es asesoramiento financiero.** Las herramientas están en `scripts/investigacion/` (`aprendizaje.ts`, `modelos.ts`) y sus tests en `tests/investigacion.test.ts`.

## Respuesta corta

**No de manera confiable, con la prueba que se hizo.** Se entrenaron siete modelos «hacia adelante» (cada uno solo con lo que ya había pasado) para ordenar las decisiones de la mesa. Ninguno cumplió el criterio que se fijó antes de mirar. **No se adoptó ninguno: la mesa no usa ningún filtro ni probabilidad salidos de estos modelos, y no se inventó ninguna.**

Lo que sí aprende la app es observación medida con su muestra (abajo), y eso nunca cambia las reglas de la mesa. Es la regla del proyecto: el aprendizaje es controlado y auditable, y la IA no modifica sus reglas fundamentales ni ejecuta código generado por ella misma.

## La pregunta

Se pidió «la mejor forma de aprendizaje». Para que un aprendizaje sirva de algo tiene que cumplirse una cosa verificable: ordenar las operaciones **mejor que la mesa sola, en datos que no vio**. Si no, es un número que parece inteligente y no lo es.

## Cómo se probó

- **El material.** Una fila por cada decisión de la mesa con reglas v2, velas de 1 h, diez monedas, 2021-01 a 2026-09: 27.968 decisiones, de las que el 37,1% llegó al primer objetivo (TP1) y el resultado medio fue +0,056 R. Se cuentan *todas* las decisiones, no una operación a la vez, así que se solapan en el tiempo y **no son independientes**: la muestra efectiva es bastante menor que 27.968. Las órdenes límite que nunca se llenaron no cuentan.
- **Qué sabe el modelo de cada decisión.** 35 datos, todos calculados solo con velas cerradas y expresados «a favor del lado» de la operación: el consenso de los especialistas y cuánto acuerdan, los sesgos de técnico, estructura y volumen, el régimen de volatilidad, la alineación y la tendencia en 1 h / 4 h / 1 d, RSI, distancia a las medias, volumen relativo, variación de 24 h, la última ruptura de estructura, la geometría del plan (distancia del stop en ATR, R:R, distancia del TP1 en R, si es orden límite), la referencia de BTC, la antigüedad de la señal y el momentum (lista en `DATOS_DEL_MODELO`). Derivados, noticias y sentimiento no tienen historia, así que no entran.
- **Los modelos** (sin dependencias, en `modelos.ts`): regresión logística (probabilidad de llegar al TP1), regresión ridge (R esperado) y árboles potenciados chicos (80 rondas de profundidad 2 y 200 rondas de profundidad 3), para el TP1 y para el R.
- **Entrenamiento hacia adelante.** Cada trimestre se entrena solo con operaciones que ya se habían resuelto antes de que el trimestre empezara (`fin` anterior al inicio), con un mínimo de 1.500 operaciones. Un test con datos «envenenados» comprueba que nada del futuro entra al modelo.
- **Dos períodos.** DESARROLLO, 2022-07 a 2025-06 (14.521 decisiones): con ese se elige. FINAL, 2025-07 a 2026-09 (6.104): se mira una sola vez.
- **La medida.** Dentro de cada período se ordenan las decisiones por el puntaje del modelo y se compara el R medio de la mitad con mejor puntaje contra el de la mitad con peor puntaje: **«alta − baja»**. Un modelo útil da positivo. Entre corchetes, el intervalo del 90%, remuestreando semanas enteras (500 repeticiones, semilla fija) para no suponer que las operaciones son independientes. Para los modelos de TP1 también el AUC (0,5 = azar).
- **El criterio, fijado antes de mirar.** Un modelo cuenta solo si el intervalo de «alta − baja» en DESARROLLO queda por encima de cero. FINAL confirma o desmiente; no sirve para elegir.

## Resultados

«Alta» y «baja» son el resultado medio en R de cada mitad. Positivo en «alta − baja» = el modelo ordena bien.

| Modelo | DESARROLLO: alta / baja | DESARROLLO: alta − baja | FINAL: alta / baja | FINAL: alta − baja |
| --- | --- | --- | --- | --- |
| Logística → TP1, λ = 100 | −0,090 / −0,002 | −0,088 [−0,162 a −0,009] | +0,083 / +0,084 | −0,002 [−0,095 a +0,094] |
| Logística → TP1, λ = 10.000 | −0,116 / +0,024 | −0,140 [−0,226 a −0,051] | +0,040 / +0,127 | −0,087 [−0,174 a +0,001] |
| Árboles → TP1, 80 × prof. 2 | −0,065 / −0,027 | −0,038 [−0,108 a +0,042] | +0,016 / +0,151 | −0,135 [−0,212 a −0,041] |
| Ridge → R, λ = 300 | −0,037 / −0,055 | +0,018 [−0,063 a +0,106] | +0,143 / +0,023 | +0,120 [+0,001 a +0,242] |
| Ridge → R, λ = 3.000 | −0,055 / −0,038 | −0,017 [−0,103 a +0,074] | +0,156 / +0,011 | +0,146 [+0,035 a +0,270] |
| Árboles → R, 80 × prof. 2 | −0,025 / −0,068 | +0,043 [−0,030 a +0,122] | +0,097 / +0,070 | +0,027 [−0,087 a +0,141] |
| Árboles → R, 200 × prof. 3 | −0,022 / −0,070 | +0,048 [−0,027 a +0,123] | +0,128 / +0,039 | +0,089 [−0,020 a +0,213] |

AUC para llegar al TP1 de los modelos entrenados para eso (DESARROLLO / FINAL): logística λ = 100: 0,552 / 0,583; logística λ = 10.000: 0,520 / 0,574; árboles: 0,554 / 0,570. (0,5 es el azar).

## Lectura

- **Ningún modelo cumple el criterio.** El mejor límite inferior en DESARROLLO es −0,027 (árboles → R, 200 × prof. 3): todos los intervalos incluyen el cero o quedan por debajo.
- **Predecir el TP1 no sirve para elegir operaciones.** El TP1 es apenas predecible (AUC de 0,52 a 0,58), y la mitad a la que el modelo le da más chance de llegar al TP1 rinde igual o *menos* R (de −0,002 a −0,140). No es información nueva sino la geometría del plan: con un TP1 más cerca se llega más seguido y se cobra menos.
- **Los modelos de R no son consistentes entre períodos.** En DESARROLLO dan entre −0,017 y +0,048, con intervalos que incluyen cero. En FINAL dan entre +0,027 y +0,146, y solo los dos ridge tienen el intervalo apenas por encima de cero (límites inferiores +0,001 y +0,035). Son los mismos modelos que en DESARROLLO no se distinguían de cero.
- **Catorce intervalos, cinco que excluyen cero.** Por azar se esperaría uno o dos. Los tres negativos son de modelos de TP1 (la geometría de arriba); los dos positivos aparecen solo en FINAL. Se trata como una hipótesis para mirar hacia adelante, no como un hallazgo, y no se usa para decidir nada.
- **La falta de evidencia no es evidencia de que no haya nada.** Con intervalos de ±0,08 a ±0,12 R, esta prueba solo detecta mejoras de ese tamaño o mayores. Un efecto más chico podría existir y sería difícil de separar del ruido y de los costos.

### Cortes simples (sin modelo)

`aprendizaje.ts --cortes` parte las decisiones por una sola condición y mira el profit factor en tres períodos (2021-01 → 2024-02 / 2024-02 → 2025-06 / 2025-07 → 2026-09). Lo que cambia de signo entre períodos no se puede usar como filtro:

| Corte | Profit factor en los tres períodos |
| --- | --- |
| Régimen comprimido | 1,35 / 0,78 / 1,00 |
| Régimen expandido | 1,22 / 1,00 / 1,69 |
| Consenso a favor entre 0,50 y 0,60 | 0,94 / 0,75 / 1,52 |
| Señal de 9 lecturas seguidas o más | 1,17 / 0,81 / 1,23 |
| Largos | 1,27 / 0,85 / 1,25 |

Lo que mantiene el signo en los tres (aun así, sin margen para una regla nueva, como se ve abajo):

| Corte | Profit factor en los tres períodos |
| --- | --- |
| Contra la tendencia diaria (277 / 140 / 125 decisiones) | 0,59 / 0,75 / 0,60 |
| Contra la tendencia de BTC en 4 h (730 / 354 / 327) | 0,65 / 0,90 / 0,88 |
| TP1 a menos de 1,1 R | 1,03 / 0,82 / 1,08 |
| TP1 entre 1,5 R y 2 R | 1,24 / 0,99 / 1,18 |
| Cortos | 1,07 / 1,04 / 1,09 |

Las operaciones contra la tendencia diaria o de BTC son pocas (542 y 1.411 de 27.968), y se probó una regla que las saca («tendencia diaria no en contra», en `docs/mesa-reglas-v2.md`): casi no cambia el resultado. El TP1 más lejano se probó como regla (TP1 a 1,3 R o más y a 1,5 R o más) y no mejora en las cuatro ventanas. Los cortos son positivos en los tres períodos, pero con poco margen.

## Qué sí aprende la app (controlado y auditable)

Todo esto es observación medida, con su muestra; **nada modifica las reglas de la mesa**:

- **Papel hacia adelante** (`lib/jarvis-paper.ts`): cada operación de papel guarda por qué se tomó y cómo terminó. `statsBy` las agrupa por lado, tramo de confluencia, volatilidad y especialista a favor; `recordFor` muestra el acierto medido de operaciones parecidas al lado del puntaje (menos de 15 cerradas = «muestra mínima»). Es la única prueba que no mira el pasado.
- **JARVIS CORE** (`lib/jarvis-learn.ts`): para las rupturas y las barridas de imán, una regresión ridge sobre sus propias señales resueltas califica cada señal nueva como «aprendiendo» (menos de 30 casos), «favorable», «desfavorable» o «neutra». Las desfavorables quedan «en sombra» (se registran y se resuelven igual) y el registro muestra las tomadas contra las de sombra, así que se mide si el aprendizaje ayuda. Con poca evidencia asume que no hay ventaja.
- **La MENTE** (`lib/jarvis-mind.ts`): sus tesis son señales con fuente «IA» que se resuelven como cualquier otra; su historial vuelve al prompt.

## Qué haría falta para adoptar un modelo

Todo junto, y mostrando lo que no mejoró:

1. Intervalo del 90% por encima de cero en DESARROLLO (el criterio de arriba), no solo en el último período.
2. Mismo signo en FINAL y en el papel hacia adelante, con muestra suficiente (menos de 15 cerradas es «muestra mínima»).
3. Las tres ventanas y los costos más altos, como cualquier regla (objetivo «jarvis» de `docs/araña/objetivos.md`).
4. Que solo pueda *vetar* o bajar el riesgo (nunca agrandarlo), que se vea en pantalla con su motivo y su muestra, y que la persona pueda apagarlo.

## Lo que esto no demuestra

- **Diez monedas y una sola vela base** (1 h), con la historia que existe: no hay derivados, noticias ni sentimiento históricos, que son parte de lo que ve la mesa en vivo.
- **Modelos chicos y regularizados** (35 datos, árboles de profundidad 2 y 3). Un modelo mucho más grande con más historia podría encontrar algo; con 28.000 decisiones solapadas, el riesgo de aprender ruido crece más rápido que la capacidad de detectarlo.
- **Selección.** Se probaron siete modelos en dos períodos y se mostraron todos. Cada intervalo del 90% no corrige por haber mirado varios.
- **El pasado no garantiza el futuro.** El control que importa es el papel hacia adelante.
