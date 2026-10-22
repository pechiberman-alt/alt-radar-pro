# Estudio agente por agente sobre el pasado

Qué se midió: cada estrategia de los agentes de papel, con sus reglas sin tocar, en velas de 4 h de Binance de las 10 monedas
del servidor, de enero de 2021 a septiembre de 2026, en tres períodos y con dos costos por lado (0,07 % y 0,15 %). Misma
entrada (apertura siguiente), misma escalera y horizonte de 48 velas que en el servidor. Script:
`scripts/investigacion/agentes-estudio.ts`.

**Criterio fijado antes de mirar** para conservar un agente: expectancia positiva con t ≥ 2 en los tres períodos con 0,07 %, y
positiva en los tres con 0,15 %. Se prueban 23 agentes a la vez: alguno puede pasar por azar; lo que pase se mide después hacia
adelante antes de creerle.

## Resultados (costo 0,07 %; la penúltima columna, con 0,15 %)

| Agente | 2021–2022 (n · R · t) | 2023–2024 (n · R · t) | 2025–sep 2026 (n · R · t) | 0,15 %: R por período | Pasa |
|---|---|---|---|---|---|
| ABSORCION | 569 · -0,09 · -1,68 | 676 · -0,06 · -1,09 | 506 · -0,02 · -0,26 | -0,12 / -0,11 / -0,07 | no |
| AMD_IFVG | 224 · 0,08 · 0,94 | 226 · 0,12 · 1,21 | 240 · 0,02 · 0,25 | 0,06 / 0,08 / -0,02 | no |
| BARRIDA_VOL | 1125 · -0,01 · -0,30 | 1207 · -0,03 · -0,72 | 1033 · -0,05 · -1,11 | -0,05 / -0,09 / -0,12 | no |
| BOLLINGER | 2688 · -0,01 · -0,51 | 2718 · -0,06 · -2,42 | 2320 · -0,04 · -1,50 | -0,05 / -0,12 / -0,10 | no |
| CRUCE_EMA | 785 · 0,08 · 1,50 | 831 · -0,00 · -0,04 | 760 · 0,03 · 0,67 | 0,03 / -0,07 / -0,04 | no |
| ESFUERZO | 0 · — · — | 0 · — · — | 1 · -1,02 · — | — / — / -1,05 | no |
| FIB_NIVELES | 426 · -0,08 · -1,17 | 394 · -0,09 · -1,30 | 346 · -0,00 · -0,02 | -0,11 / -0,13 / -0,05 | no |
| MACD | 1730 · 0,09 · 2,56 | 1711 · -0,01 · -0,31 | 1442 · 0,01 · 0,22 | 0,05 / -0,08 / -0,06 | no |
| MACD_MTF_SNR | 74 · -0,00 · -0,00 | 90 · 0,28 · 1,76 | 48 · -0,25 · -1,28 | -0,04 / 0,21 / -0,32 | no |
| RETROCESO | 4947 · 0,09 · 4,44 | 4910 · -0,07 · -3,61 | 4133 · -0,01 · -0,63 | 0,05 / -0,14 / -0,08 | no |
| RSI | 1334 · -0,08 · -2,47 | 1273 · -0,17 · -5,03 | 1162 · -0,05 · -1,39 | -0,12 / -0,22 / -0,11 | no |
| RUPTURA | 3977 · 0,08 · 4,16 | 3670 · 0,08 · 4,06 | 3671 · -0,00 · -0,02 | 0,06 / 0,05 / -0,03 | no |
| SMC_LIQUIDEZ | 59 · 0,03 · 0,18 | 68 · -0,01 · -0,06 | 54 · 0,19 · 1,15 | 0,00 / -0,04 / 0,17 | no |
| SMC_TODO | 11 · 0,09 · 0,25 | 9 · -0,23 · -0,56 | 3 · 1,65 · 4,90 | 0,06 / -0,26 / 1,63 | no |
| SNR | 12189 · -0,22 · -16,86 | 11834 · -0,35 · -25,92 | 10003 · -0,32 · -21,95 | -0,39 / -0,64 / -0,62 | no |
| SNR_HTF | 6217 · -0,20 · -11,12 | 6076 · -0,36 · -19,45 | 5101 · -0,33 · -15,59 | -0,37 / -0,64 / -0,63 | no |
| ST_MTF | 376 · 0,19 · 3,22 | 360 · -0,02 · -0,37 | 360 · 0,14 · 2,20 | 0,17 / -0,05 / 0,11 | no |
| ST_MTF_VOL | 205 · 0,34 · 4,27 | 218 · 0,03 · 0,39 | 212 · 0,24 · 2,80 | 0,32 / 0,00 / 0,21 | no |
| ST_PERFIL | 432 · 0,10 · 1,74 | 436 · 0,09 · 1,47 | 406 · 0,13 · 2,17 | 0,08 / 0,06 / 0,10 | no |
| ST_VWAP | 516 · 0,09 · 1,75 | 514 · 0,05 · 0,95 | 501 · 0,15 · 2,89 | 0,07 / 0,02 / 0,12 | no |
| ST_VWAP_PERFIL | 431 · 0,10 · 1,73 | 428 · 0,09 · 1,49 | 403 · 0,13 · 2,24 | 0,08 / 0,06 / 0,10 | no |
| SUPERTREND | 517 · 0,09 · 1,76 | 523 · 0,05 · 0,91 | 506 · 0,15 · 2,91 | 0,07 / 0,02 / 0,12 | no |
| TENDENCIA_LINEA | 1266 · 0,09 · 2,31 | 1261 · 0,01 · 0,32 | 1104 · 0,06 · 1,45 | 0,05 / -0,05 / -0,00 | no |

Pasan el criterio: ninguno (de 23).

## Lectura honesta

- **Ningún agente pasa el criterio.**
- **La familia Supertrend** (SUPERTREND, ST_VWAP, ST_PERFIL, ST_VWAP_PERFIL) es la única positiva en los tres períodos con los dos
  costos, pero con t menor a 2 en al menos un período: prometedora, no demostrada. Son variantes de la misma idea: no cuentan
  como cuatro pruebas independientes.
- **ST_MTF_VOL y ST_MTF** son fuertes en dos períodos y planas en 2023–2024.
- **SNR y SNR_HTF pierden fuerte y siempre** (t entre −11 y −26) y son las que más operan: explican la mayor parte de la pérdida
  de los agentes todos juntos y de la pizarra de cripto (docs/estudio-pizarra.md). **RSI** y **BOLLINGER** también pierden.
- Pausar o revisar un agente lo decide la persona (regla del laboratorio): este estudio da los números para decidir, no cambia
  nada solo.

**Decisión (22/10/2026):** la persona pausó SNR, SNR_HTF, RSI y BOLLINGER (`AGENTES_PAUSADOS` en `lib/agentes-papel.ts`): no abren
operaciones nuevas ni opinan en la pizarra; su historial queda. Volver a activarlos es otra decisión.

Es pasado y de papel: no garantiza nada. No es asesoramiento financiero.
