# Estudio de estrategias del AI TRADING LAB

Generado el 2026-10-14 con `scripts/investigacion/estrategias.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT), del 2020-01-01 al 2026-09-30. Desarrollo hasta el 2024-09-21; evaluación después. Costos: 0,07 % por lado (comisión + deslizamiento supuesto). Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

Cada agente tiene una estrategia clásica con parámetros fijos (no se optimizaron). El veredicto sale solo de la EVALUACIÓN: VENTAJA exige al menos 100 operaciones, el intervalo del 90 % de la expectancia entero por encima de cero y ganarle al agente de control (entradas al azar). Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.

## Evaluación (lo que cuenta), ordenado por expectancia

| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia (IC 90 %) | Caída máx | Monedas + | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agente Supertrend MTF + Volumen | 4h | 227 | 51,1 % | 58,6 % | 37,0 % | 25,1 % | 38,8 % | 1,54 | +0,237 R (+0,102 R a +0,371 R) | 13,42 R | 9/10 | VENTAJA |
| Agente Supertrend | 4h | 438 | 48,6 % | 59,1 % | 35,4 % | 22,8 % | 40,0 % | 1,37 | +0,169 R (+0,074 R a +0,263 R) | 21,41 R | 10/10 | VENTAJA |
| Agente Supertrend + VWAP | 4h | 434 | 48,2 % | 58,8 % | 35,3 % | 22,8 % | 40,1 % | 1,36 | +0,164 R (+0,069 R a +0,260 R) | 21,41 R | 10/10 | VENTAJA |
| Agente Supertrend + Perfil | 4h | 374 | 46,3 % | 56,4 % | 35,0 % | 23,5 % | 41,7 % | 1,29 | +0,134 R (+0,031 R a +0,238 R) | 19,57 R | 9/10 | VENTAJA |
| Agente Supertrend + VWAP + Perfil | 4h | 371 | 46,1 % | 56,3 % | 35,0 % | 23,5 % | 41,5 % | 1,29 | +0,134 R (+0,030 R a +0,238 R) | 19,57 R | 9/10 | VENTAJA |
| Agente Supertrend MTF | 4h | 375 | 46,1 % | 56,5 % | 34,7 % | 21,9 % | 41,9 % | 1,27 | +0,128 R (+0,026 R a +0,231 R) | 21,22 R | 10/10 | VENTAJA |
| Agente Ruptura | 1h | 4070 | 42,6 % | 55,2 % | 32,6 % | 20,9 % | 40,5 % | 1,06 | +0,030 R (-0,000 R a +0,060 R) | 77,13 R | 6/10 | SIN CONCLUSIÓN |
| Agente Ruptura | 4h | 1026 | 41,2 % | 58,0 % | 33,0 % | 19,2 % | 43,5 % | 1,02 | +0,008 R (-0,051 R a +0,068 R) | 42,33 R | 7/10 | SIN CONCLUSIÓN |
| Agente Tendencia | 4h | 765 | 36,5 % | 59,2 % | 44,4 % | 34,0 % | 63,3 % | 1,01 | +0,004 R (-0,080 R a +0,088 R) | 72,66 R | 5/10 | SIN CONCLUSIÓN |
| Agente Momento | 4h | 1231 | 36,1 % | 60,2 % | 43,3 % | 34,2 % | 63,5 % | 1,00 | +0,001 R (-0,066 R a +0,067 R) | 61,09 R | 5/10 | SIN CONCLUSIÓN |
| Agente Control (azar) | 1h | 2895 | 38,1 % | 63,6 % | 46,0 % | 34,8 % | 60,5 % | 0,99 | -0,010 R (-0,053 R a +0,034 R) | 183,13 R | 7/10 | CONTROL |
| Agente Supertrend + Perfil | 1h | 1580 | 40,4 % | 54,0 % | 31,1 % | 19,6 % | 43,6 % | 0,97 | -0,014 R (-0,062 R a +0,035 R) | 69,43 R | 4/10 | SIN CONCLUSIÓN |
| Agente Retroceso | 4h | 1624 | 35,2 % | 59,8 % | 42,0 % | 33,6 % | 64,1 % | 0,97 | -0,017 R (-0,075 R a +0,041 R) | 95,38 R | 6/10 | SIN CONCLUSIÓN |
| Agente Supertrend + VWAP | 1h | 1630 | 40,9 % | 54,1 % | 31,0 % | 19,0 % | 43,4 % | 0,97 | -0,018 R (-0,065 R a +0,030 R) | 65,14 R | 4/10 | SIN CONCLUSIÓN |
| Agente Control (azar) | 4h | 766 | 35,4 % | 58,2 % | 43,9 % | 32,6 % | 63,7 % | 0,97 | -0,020 R (-0,104 R a +0,063 R) | 61,55 R | 4/10 | CONTROL |
| Agente Supertrend + VWAP + Perfil | 1h | 1481 | 40,1 % | 53,9 % | 30,9 % | 19,1 % | 43,7 % | 0,96 | -0,023 R (-0,073 R a +0,027 R) | 62,17 R | 4/10 | SIN CONCLUSIÓN |
| Agente Supertrend | 1h | 1783 | 40,5 % | 53,4 % | 30,3 % | 19,0 % | 44,4 % | 0,94 | -0,031 R (-0,076 R a +0,014 R) | 95,51 R | 4/10 | SIN CONCLUSIÓN |
| Agente Supertrend MTF | 1h | 1426 | 40,0 % | 54,1 % | 30,9 % | 18,3 % | 44,9 % | 0,92 | -0,043 R (-0,093 R a +0,008 R) | 103,71 R | 4/10 | SIN CONCLUSIÓN |
| Agente Supertrend MTF + Volumen | 1h | 870 | 39,7 % | 54,6 % | 30,1 % | 17,2 % | 43,1 % | 0,91 | -0,047 R (-0,110 R a +0,016 R) | 61,42 R | 5/10 | SIN CONCLUSIÓN |
| Agente Bandas | 4h | 2257 | 40,5 % | 66,1 % | 49,8 % | 39,4 % | 59,0 % | 0,92 | -0,049 R (-0,091 R a -0,007 R) | 159,23 R | 3/10 | SIN VENTAJA |
| Agente Reversión | 4h | 1182 | 40,1 % | 65,0 % | 48,1 % | 38,3 % | 59,0 % | 0,91 | -0,058 R (-0,116 R a -0,000 R) | 96,27 R | 3/10 | SIN VENTAJA |
| Agente Momento | 1h | 4998 | 34,9 % | 59,9 % | 43,2 % | 33,1 % | 64,1 % | 0,87 | -0,093 R (-0,126 R a -0,061 R) | 479,56 R | 1/10 | SIN VENTAJA |
| Agente Retroceso | 1h | 6518 | 34,2 % | 58,8 % | 42,3 % | 32,0 % | 64,9 % | 0,84 | -0,118 R (-0,146 R a -0,090 R) | 779,65 R | 1/10 | SIN VENTAJA |
| Agente Tendencia | 1h | 3106 | 34,2 % | 59,6 % | 42,1 % | 31,7 % | 64,5 % | 0,83 | -0,121 R (-0,162 R a -0,080 R) | 404,16 R | 2/10 | SIN VENTAJA |
| Agente Bandas | 1h | 8677 | 39,7 % | 65,8 % | 49,0 % | 38,4 % | 59,7 % | 0,80 | -0,134 R (-0,155 R a -0,112 R) | 1172,86 R | 0/10 | SIN VENTAJA |
| Agente Reversión | 1h | 4368 | 38,6 % | 64,0 % | 47,3 % | 37,2 % | 60,6 % | 0,77 | -0,155 R (-0,185 R a -0,125 R) | 707,08 R | 0/10 | SIN VENTAJA |

## Desarrollo (para comparar: si gana acá y pierde en evaluación, no se sostiene)

| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia |
|---|---|---|---|---|---|---|---|---|---|
| Agente Ruptura | 1h | 9176 | 41,8 % | 54,0 % | 31,7 % | 19,6 % | 42,9 % | 1,00 | -0,001 R |
| Agente Tendencia | 1h | 6676 | 36,2 % | 61,2 % | 43,8 % | 33,0 % | 62,3 % | 0,93 | -0,048 R |
| Agente Reversión | 1h | 9794 | 38,4 % | 64,6 % | 47,2 % | 36,4 % | 60,8 % | 0,79 | -0,137 R |
| Agente Bandas | 1h | 19950 | 39,4 % | 65,2 % | 48,3 % | 37,6 % | 59,7 % | 0,82 | -0,116 R |
| Agente Retroceso | 1h | 14758 | 35,0 % | 58,9 % | 41,8 % | 31,8 % | 63,5 % | 0,89 | -0,076 R |
| Agente Momento | 1h | 11484 | 35,2 % | 59,5 % | 42,5 % | 32,9 % | 63,7 % | 0,91 | -0,065 R |
| Agente Supertrend | 1h | 3811 | 44,0 % | 55,2 % | 32,0 % | 19,2 % | 39,9 % | 1,09 | +0,044 R |
| Agente Supertrend + VWAP | 1h | 3503 | 45,0 % | 55,9 % | 32,5 % | 20,0 % | 39,2 % | 1,15 | +0,069 R |
| Agente Supertrend + Perfil | 1h | 3382 | 44,4 % | 55,5 % | 32,2 % | 19,2 % | 39,9 % | 1,11 | +0,050 R |
| Agente Supertrend + VWAP + Perfil | 1h | 3219 | 45,4 % | 56,4 % | 33,0 % | 20,2 % | 39,2 % | 1,17 | +0,078 R |
| Agente Supertrend MTF | 1h | 2932 | 44,2 % | 56,0 % | 33,4 % | 20,4 % | 41,1 % | 1,12 | +0,056 R |
| Agente Supertrend MTF + Volumen | 1h | 1923 | 45,4 % | 56,4 % | 33,7 % | 20,3 % | 38,7 % | 1,18 | +0,085 R |
| Agente Control (azar) | 1h | 6583 | 35,1 % | 62,2 % | 43,6 % | 30,8 % | 63,7 % | 0,87 | -0,088 R |
| Agente Ruptura | 4h | 2307 | 44,2 % | 57,3 % | 35,3 % | 22,4 % | 41,6 % | 1,21 | +0,099 R |
| Agente Tendencia | 4h | 1661 | 37,4 % | 62,1 % | 45,6 % | 34,5 % | 61,4 % | 1,07 | +0,044 R |
| Agente Reversión | 4h | 2648 | 37,2 % | 65,0 % | 47,2 % | 35,3 % | 62,1 % | 0,81 | -0,123 R |
| Agente Bandas | 4h | 5021 | 40,5 % | 65,9 % | 49,6 % | 38,7 % | 59,1 % | 0,93 | -0,045 R |
| Agente Retroceso | 4h | 3478 | 36,7 % | 60,7 % | 43,4 % | 32,8 % | 61,8 % | 1,02 | +0,015 R |
| Agente Momento | 4h | 2767 | 37,0 % | 63,2 % | 44,5 % | 34,3 % | 61,8 % | 1,06 | +0,040 R |
| Agente Supertrend | 4h | 938 | 43,9 % | 52,9 % | 30,3 % | 19,2 % | 41,6 % | 1,07 | +0,035 R |
| Agente Supertrend + VWAP | 4h | 928 | 44,1 % | 53,1 % | 30,5 % | 19,4 % | 41,6 % | 1,08 | +0,039 R |
| Agente Supertrend + Perfil | 4h | 813 | 45,5 % | 55,0 % | 33,6 % | 21,5 % | 41,7 % | 1,18 | +0,088 R |
| Agente Supertrend + VWAP + Perfil | 4h | 804 | 45,5 % | 55,1 % | 33,8 % | 21,8 % | 41,9 % | 1,19 | +0,090 R |
| Agente Supertrend MTF | 4h | 812 | 46,1 % | 55,8 % | 34,0 % | 21,1 % | 39,8 % | 1,21 | +0,099 R |
| Agente Supertrend MTF + Volumen | 4h | 483 | 47,4 % | 56,1 % | 35,8 % | 23,4 % | 36,6 % | 1,40 | +0,175 R |
| Agente Control (azar) | 4h | 1754 | 34,2 % | 55,9 % | 38,9 % | 30,0 % | 64,7 % | 0,90 | -0,066 R |
