# Agente AMD + IFVG: medición con la regla fijada de antemano

Generado el 2026-10-21 con `scripts/investigacion/amd-estudio.ts`. Regla: `lib/amd-ifvg.ts` (PLAN_AMD_2, comparado con PLAN_AMD_1). Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min. Desarrollo hasta el 2024-09-21, evaluación después (el corte del estudio). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## La regla (no se buscó: los números se fijaron antes de medir)

- **Acumulación**: las 20 velas anteriores forman un rango de 4 ATR de alto o menos.
- **Manipulación**: una vela barre un solo lado del rango. Solo cuenta la primera barrida de una racha.
- **Última pata**: un hueco de valor justo en contra, formado desde 5 velas antes de la barrida, que una vela cierra por el otro lado (IFVG) dentro de las 12 velas siguientes, con el cierre de vuelta adentro del rango.
- **Operación**: entra a la apertura siguiente. Stop a 0,5 ATR del extremo de la manipulación. No opera si el stop queda a más de 4 ATR.
- **Objetivo (PLAN_AMD_2, desde el 2026-10-21)**: como en el video, el FVG de la temporalidad alta (6 velas de la serie: 4 h → diario, 1 h → 6 h, 15 min → 1 h 30). El borde cercano del FVG sin llenar más cercano en la dirección de la operación; si queda a menos de 1 R o no hay, no opera. El 6 se fijó antes de medir (en el video es 5 s → 5 min, 60 veces; con 4 h serían 10 días y casi no habría FVG en el historial).
- **PLAN_AMD_1** (antes): la misma entrada con el objetivo fijo a 2 R. Se mide al lado para comparar.
- **Fractal**: la misma regla en las tres temporalidades, sin cambiar ningún número.

## Evaluación (el tramo que decide): PLAN_AMD_2

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
| 1h | 805 | 37,1 % | 0,93 | -0,043 | -0,129 a +0,042 |
| 4h | 230 | 40,4 % | 0,97 | -0,018 | -0,163 a +0,127 |
| 15m | 3863 | 39,3 % | 0,85 | -0,099 | -0,137 a -0,062 |

## Evaluación: PLAN_AMD_1 (objetivo fijo a 2 R), para comparar

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
| 1h | 1326 | 38,2 % | 0,81 | -0,115 | -0,170 a -0,061 |
| 4h | 366 | 40,2 % | 1,00 | -0,002 | -0,110 a +0,105 |
| 15m | 5996 | 38,5 % | 0,79 | -0,137 | -0,163 a -0,110 |

## Oro de Axi (XAUUSD.c, 4 h, 0,07 % por lado, corte 70/30 propio al 2025-04-14)

| Plan | n desarrollo | E[R] desarrollo | n evaluación | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|---|
| PLAN_AMD_2 (FVG alto) | 17 | -0,048 | 8 | 50,0 % | 1,10 | +0,052 | -0,661 a +0,765 |
| PLAN_AMD_1 (2 R) | 39 | -0,331 | 17 | 52,9 % | 1,67 | +0,341 | -0,220 a +0,903 |

| Marco | Control al azar E[R] | Veredicto | PSR | DSR (570 ensayos) |
|---|---|---|---|---|
| 1h | -0,010 (n=2895) | SIN CONCLUSIÓN | 0,21 | 0,00 |
| 4h | -0,020 (n=766) | SIN CONCLUSIÓN | 0,42 | 0,00 |
| 15m | -0,294 (n=11260) | SIN VENTAJA | 0,00 | 0,00 |

## Desarrollo

| Marco | Plan | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|
| 1h | 2 | 1777 | 42,8 % | 1,05 | +0,027 | -0,025 a +0,079 |
| 4h | 2 | 427 | 44,3 % | 1,28 | +0,142 | +0,030 a +0,254 |
| 15m | 2 | 1242 | 40,4 % | 0,89 | -0,067 | -0,133 a -0,001 |
| 1h | 1 | 2937 | 42,9 % | 1,02 | +0,013 | -0,024 a +0,049 |
| 4h | 1 | 740 | 47,6 % | 1,26 | +0,123 | +0,049 a +0,197 |
| 15m | 1 | 2057 | 41,8 % | 0,90 | -0,062 | -0,107 a -0,017 |

## Cómo leerlo

- E[R] es la ganancia media por operación en R, neta de costos. Un intervalo que cruza cero no da conclusión.
- El período de evaluación ya se miró con otras estrategias del estudio: no es una prueba limpia, y el DSR cuenta 570 ensayos por eso.
- La regla viene de un video (AMD e IFVG de la última pata, objetivo en el FVG de la temporalidad alta). No se ajustó con estos datos; la única corrección antes de medir fue que solo cuente la primera barrida de una racha, que encontró una prueba. El cambio de PLAN_AMD_1 a PLAN_AMD_2 lo pidió la persona para seguir el video, no salió de estos números.
- La única prueba limpia es la medición hacia adelante en papel, que arranca cuando el agente se enciende (en papel corre en 4 h, como todos los agentes, sobre cripto, oro y plata).
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero.
