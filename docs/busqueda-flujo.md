# Mesa de flujo: medición con las reglas fijadas de antemano

Generado el 2026-10-21 con `scripts/investigacion/flujo-estudio.ts`. Reglas: `lib/flujo-agentes.ts` (PLAN_FLUJO_AGENTES_1). Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min. Desarrollo hasta el 2024-09-21, evaluación después (el corte del estudio). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Las reglas (no se buscaron: los números se fijaron antes de medir)

- **Absorción (ABSORCION)**: la vela hace el mínimo (o máximo) de las 20 anteriores con 2 veces el volumen promedio y cierra a más del 60 % de su rango lejos de ese extremo.
- **Esfuerzo sin resultado (ESFUERZO)**: después de un tramo de 2 ATR en 5 velas, una vela con 2,5 veces el volumen promedio y un rango de 0,7 ATR o menos que cierra en la mitad contraria al tramo. Entra en contra del tramo.
- **Barrida con volumen (BARRIDA_VOL)**: la vela pasa el mínimo (o máximo) de las 20 anteriores con 1,5 veces el volumen promedio y cierra de vuelta adentro.
- **Operación**: entra a la apertura siguiente. Stop a 0,25 ATR del extremo. Objetivo 2 R.
- **Delta (DELTA_DIV, DELTA_ABSORBIDO)**: necesitan el volumen agresor comprador de cada vela, que este historial no trae. No se miden acá: solo hacia adelante, en papel, con las velas de Binance del navegador.

## Evaluación (el tramo que decide)

| Agente | Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|
| ABSORCION | 1h | 2463 | 34,6 % | 0,80 | -0,143 | -0,187 a -0,099 |
| ESFUERZO | 1h | 4 | 0,0 % | 0,00 | -1,421 | -1,777 a -1,064 |
| BARRIDA_VOL | 1h | 4028 | 33,2 % | 0,75 | -0,183 | -0,219 a -0,148 |
| ABSORCION | 4h | 537 | 35,4 % | 0,91 | -0,058 | -0,153 a +0,036 |
| ESFUERZO | 4h | 1 | 0,0 % | 0,00 | -1,022 | — |
| BARRIDA_VOL | 4h | 990 | 35,3 % | 0,92 | -0,057 | -0,129 a +0,015 |
| ABSORCION | 15m | 9992 | 33,6 % | 0,63 | -0,300 | -0,322 a -0,277 |
| ESFUERZO | 15m | 40 | 37,5 % | 0,59 | -0,378 | -0,783 a +0,027 |
| BARRIDA_VOL | 15m | 15499 | 33,6 % | 0,63 | -0,317 | -0,335 a -0,298 |

| Agente | Marco | Control al azar E[R] | Veredicto | PSR | DSR (580 ensayos) |
|---|---|---|---|---|---|
| ABSORCION | 1h | -0,010 (n=2895) | SIN VENTAJA | 0,00 | 0,00 |
| ESFUERZO | 1h | -0,010 (n=2895) | SIN CONCLUSIÓN | 0,00 | 0,00 |
| BARRIDA_VOL | 1h | -0,010 (n=2895) | SIN VENTAJA | 0,00 | 0,00 |
| ABSORCION | 4h | -0,020 (n=766) | SIN CONCLUSIÓN | 0,16 | 0,00 |
| ESFUERZO | 4h | -0,020 (n=766) | SIN CONCLUSIÓN | — | — |
| BARRIDA_VOL | 4h | -0,020 (n=766) | SIN CONCLUSIÓN | 0,10 | 0,00 |
| ABSORCION | 15m | -0,294 (n=11260) | SIN VENTAJA | 0,00 | 0,00 |
| ESFUERZO | 15m | -0,294 (n=11260) | SIN CONCLUSIÓN | 0,07 | 0,00 |
| BARRIDA_VOL | 15m | -0,294 (n=11260) | SIN VENTAJA | 0,00 | 0,00 |

## Evaluación por lado

| Agente | Marco | Largos n | Largos E[R] | Cortos n | Cortos E[R] |
|---|---|---|---|---|---|
| ABSORCION | 1h | 1176 | -0,114 | 1287 | -0,170 |
| ESFUERZO | 1h | 2 | -1,729 | 2 | -1,112 |
| BARRIDA_VOL | 1h | 1934 | -0,177 | 2094 | -0,190 |
| ABSORCION | 4h | 241 | -0,055 | 296 | -0,061 |
| ESFUERZO | 4h | 1 | -1,022 | 0 | — |
| BARRIDA_VOL | 4h | 456 | +0,003 | 534 | -0,108 |
| ABSORCION | 15m | 5195 | -0,286 | 4797 | -0,315 |
| ESFUERZO | 15m | 21 | -0,154 | 19 | -0,626 |
| BARRIDA_VOL | 15m | 7869 | -0,311 | 7630 | -0,323 |

## Desarrollo

| Agente | Marco | n | Acierto | PF | E[R] | IC 90 % |
|---|---|---|---|---|---|---|
| ABSORCION | 1h | 5394 | 36,4 % | 0,86 | -0,093 | -0,122 a -0,063 |
| ESFUERZO | 1h | 7 | 71,4 % | 3,89 | +0,969 | +0,057 a +1,880 |
| BARRIDA_VOL | 1h | 9050 | 34,2 % | 0,81 | -0,133 | -0,157 a -0,110 |
| ABSORCION | 4h | 1228 | 34,8 % | 0,88 | -0,077 | -0,139 a -0,015 |
| ESFUERZO | 4h | 0 | — | — | — | — |
| BARRIDA_VOL | 4h | 2126 | 34,6 % | 0,91 | -0,061 | -0,110 a -0,013 |
| ABSORCION | 15m | 3540 | 33,4 % | 0,65 | -0,278 | -0,315 a -0,241 |
| ESFUERZO | 15m | 8 | 50,0 % | 0,97 | -0,020 | -0,996 a +0,955 |
| BARRIDA_VOL | 15m | 5523 | 33,6 % | 0,64 | -0,300 | -0,331 a -0,270 |

Rangos de datos: 1h 2020-01-01 a 2026-09-30; 4h 2020-01-01 a 2026-09-30; 15m 2024-01-01 a 2026-09-30.

## Cómo leerlo

- E[R] es la ganancia media por operación en R, neta de costos. Un intervalo que cruza cero no da conclusión.
- El período de evaluación ya se miró con otras estrategias del estudio: no es una prueba limpia, y el DSR cuenta 580 ensayos por eso.
- Las reglas son lecturas clásicas del flujo de órdenes (absorción, esfuerzo contra resultado, barrida de stops). No se ajustaron con estos datos y no se van a ajustar para mejorar estos números: una versión nueva lleva otro PLAN y se mide al lado.
- ESFUERZO casi no dispara con sus números (un tramo de 2 ATR en 5 velas, rango chico y volumen 2,5 veces mayor rara vez coinciden): sus pocas operaciones no dicen nada. No se aflojan los números mirando estos resultados; una versión que dispare más va como PLAN nuevo y se mide al lado.
- El volumen de una vela no dice quién agredió: estas tres leen el esfuerzo con el volumen total. Las dos de delta sí lo dicen, y por eso solo se pueden medir hacia adelante.
- La única prueba limpia es la medición hacia adelante en papel, que arranca cuando los agentes se encienden (en papel corren en 4 h, como todos).
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero.
