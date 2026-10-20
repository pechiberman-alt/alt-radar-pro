# Agente AMD + IFVG: medición con la regla fijada de antemano

Generado el 2026-10-20 con `scripts/investigacion/amd-estudio.ts`. Regla: `lib/amd-ifvg.ts` (PLAN_AMD_1). Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min. Desarrollo hasta el 2024-09-21, evaluación después (el corte del estudio). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## La regla (no se buscó: los números se fijaron antes de medir)

- **Acumulación**: las 20 velas anteriores forman un rango de 4 ATR de alto o menos.
- **Manipulación**: una vela barre un solo lado del rango. Solo cuenta la primera barrida de una racha.
- **Última pata**: un hueco de valor justo en contra, formado desde 5 velas antes de la barrida, que una vela cierra por el otro lado (IFVG) dentro de las 12 velas siguientes, con el cierre de vuelta adentro del rango.
- **Operación**: entra a la apertura siguiente. Stop a 0,5 ATR del extremo de la manipulación. Objetivo 2 R. No opera si el stop queda a más de 4 ATR.
- **Fractal**: la misma regla en las tres temporalidades, sin cambiar ningún número.

## Evaluación (el tramo que decide)

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
| 1h | 1326 | 38,2 % | 0,81 | -0,115 | -0,170 a -0,061 |
| 4h | 366 | 40,2 % | 1,00 | -0,002 | -0,110 a +0,105 |
| 15m | 5996 | 38,5 % | 0,79 | -0,137 | -0,163 a -0,110 |

| Marco | Control al azar E[R] | Veredicto | PSR | DSR (560 ensayos) |
|---|---|---|---|---|
| 1h | -0,010 (n=2895) | SIN VENTAJA | 0,00 | 0,00 |
| 4h | -0,020 (n=766) | SIN CONCLUSIÓN | 0,49 | 0,00 |
| 15m | -0,294 (n=11260) | SIN VENTAJA | 0,00 | 0,00 |

## Desarrollo

| Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|
| 1h | 2937 | 42,9 % | 1,02 | +0,013 | -0,024 a +0,049 |
| 4h | 740 | 47,6 % | 1,26 | +0,123 | +0,049 a +0,197 |
| 15m | 2057 | 41,8 % | 0,90 | -0,062 | -0,107 a -0,017 |

## Cómo leerlo

- E[R] es la ganancia media por operación en R, neta de costos. Un intervalo que cruza cero no da conclusión.
- El período de evaluación ya se miró con otras estrategias del estudio: no es una prueba limpia, y el DSR cuenta 560 ensayos por eso.
- La regla viene de un video (AMD e IFVG de la última pata). No se ajustó con estos datos; la única corrección antes de medir fue que solo cuente la primera barrida de una racha, que encontró una prueba.
- Oro de Axi (XAUUSD.c, 4 h): el agente entra solo en `scripts/investigacion/axi-estudio.ts`. Al 2026-10-20 dio 17 operaciones en evaluación (+0,34 R a 0,07 % por lado, intervalo de −0,22 a +0,90): muestra chica, sin conclusión.
- La única prueba limpia es la medición hacia adelante en papel, que arranca cuando el agente se enciende (en papel corre en 4 h, como todos los agentes, sobre cripto, oro y plata).
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero.
