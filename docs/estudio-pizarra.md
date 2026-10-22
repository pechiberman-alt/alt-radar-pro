# Estudio de la pizarra de cripto sobre el pasado

Qué se midió: las reglas de la pizarra del servidor (`lib/pizarra-servidor.ts`, PLAN_PIZARRA_1) sin tocarlas, vela de 4 h por
vela de 4 h, de enero de 2021 a septiembre de 2026, en las 10 monedas de los agentes del servidor, con velas de Binance
(repositorio público Speirsy11/crypto-dataset) y solo lo que se sabía en cada cierre. Los agentes de papel corren con sus
reglas (entrada a la apertura siguiente, la misma escalera que en el servidor) y su récord se arma con sus propios cierres.
Script: `scripts/investigacion/pizarra-estudio.ts`.

Lo que **no** entra en el pasado: las señales del núcleo de JARVIS (aprende de su historial) y la mesa de JARVIS (corre en el
navegador). Las lentes de valor se abstienen con cripto (no hay balances). En el servidor la pizarra usa velas de Kraken; acá,
de Binance.

## Resultados

«Agentes (todas)» es la base: cada operación de cada agente. «Pizarra (todas)» son las decisiones «hay plan»; «una a la vez»
deja entrar una sola por moneda hasta que cierra (las decisiones seguidas se parecen mucho y no son independientes). t es la
expectancia contra su error: con |t| menor a 2, el resultado puede ser azar.

### Costo 0,07 % por lado

| Período | Grupo | n | Acierto | Expectancia (R) | PF | t |
|---|---|---|---|---|---|---|
| 2021–2022 | Agentes (todas) | 40098 | 37 % | -0,07 | 0,90 | -9,94 |
| 2021–2022 | Pizarra (todas) | 10165 | 39 % | 0,03 | 1,05 | 2,22 |
| 2021–2022 | Pizarra (una a la vez por moneda) | 1533 | 39 % | 0,01 | 1,02 | 0,41 |
| 2023–2024 | Agentes (todas) | 39433 | 35 % | -0,17 | 0,77 | -24,22 |
| 2023–2024 | Pizarra (todas) | 9143 | 34 % | -0,13 | 0,82 | -8,47 |
| 2023–2024 | Pizarra (una a la vez por moneda) | 1613 | 37 % | -0,09 | 0,86 | -2,76 |
| 2025–sep 2026 | Agentes (todas) | 34315 | 36 % | -0,14 | 0,81 | -18,14 |
| 2025–sep 2026 | Pizarra (todas) | 7945 | 36 % | -0,08 | 0,88 | -3,95 |
| 2025–sep 2026 | Pizarra (una a la vez por moneda) | 1341 | 36 % | -0,11 | 0,85 | -2,79 |

### Costo 0,15 % por lado

| Período | Grupo | n | Acierto | Expectancia (R) | PF | t |
|---|---|---|---|---|---|---|
| 2021–2022 | Agentes (todas) | 40098 | 37 % | -0,16 | 0,78 | -23,39 |
| 2021–2022 | Pizarra (todas) | 10165 | 38 % | -0,04 | 0,94 | -2,82 |
| 2021–2022 | Pizarra (una a la vez por moneda) | 1533 | 39 % | -0,06 | 0,92 | -1,57 |
| 2023–2024 | Agentes (todas) | 39433 | 34 % | -0,33 | 0,61 | -43,94 |
| 2023–2024 | Pizarra (todas) | 9143 | 34 % | -0,26 | 0,68 | -16,44 |
| 2023–2024 | Pizarra (una a la vez por moneda) | 1613 | 36 % | -0,22 | 0,71 | -6,20 |
| 2025–sep 2026 | Agentes (todas) | 34315 | 36 % | -0,30 | 0,64 | -36,12 |
| 2025–sep 2026 | Pizarra (todas) | 7945 | 35 % | -0,21 | 0,73 | -10,25 |
| 2025–sep 2026 | Pizarra (una a la vez por moneda) | 1341 | 36 % | -0,24 | 0,69 | -5,51 |

## Lectura honesta

- **Los agentes de papel, todos juntos, pierden en los tres períodos** y con los dos costos (t entre −10 y −44). No es mala
  suerte: es la regla.
- **La pizarra pierde menos que los agentes** en los tres períodos: filtra, pero no alcanza. Con costo bajo, en 2021–2022 da
  apenas positivo (t 2,22 con todas, 0,41 una a la vez: no es firme); en 2023–2024 y 2025–2026 es negativa también una a la
  vez (t −2,8 en los dos).
- Con costo de 0,15 % por lado todo es negativo.
- **Conclusión: la pizarra de cripto del servidor, con estas reglas, no tiene ventaja demostrada en el pasado.** Sigue
  registrando en papel (PIZARRA_CRIPTO) para medirla hacia adelante, pero no es una recomendación de operar. Cambiar sus reglas
  para que este estudio dé positivo sería ajustar al pasado: si se cambia algo, se fija antes, se mide en los tres períodos con
  los dos costos y se dice lo que no mejoró.

Es pasado y de papel: no garantiza nada. No es asesoramiento financiero.
