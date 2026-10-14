# Estudio de estrategias del AI TRADING LAB

Generado el 2026-10-14 con `scripts/investigacion/estrategias.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT), del 2020-01-01 al 2026-09-30. Las velas de 15 min y de 3 min (MACD_MTF_SNR y su control; la línea de tendencia solo en 15 min) son del 2024-01-01 en adelante. Desarrollo hasta el 2024-09-21; evaluación después, en la misma ventana para todas las temporalidades. Costos: 0,07 % por lado (comisión + deslizamiento supuesto). Horizonte: 48 velas de cada temporalidad (48 h en 1 h, 8 días en 4 h, 12 h en 15 min, 2,4 h en 3 min). Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

Cada agente tiene una estrategia clásica con parámetros fijos (no se optimizaron). El veredicto sale solo de la EVALUACIÓN: VENTAJA exige al menos 100 operaciones, el intervalo del 90 % de la expectancia entero por encima de cero y ganarle al agente de control (entradas al azar); si además su DSR contando todas las variantes miradas queda debajo del 95 %, baja a CANDIDATA (ver la auditoría). Es una medición del pasado: no garantiza resultados futuros y no es asesoramiento financiero.

## Evaluación, ordenado por expectancia

| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia (IC 90 %) | Caída máx | Monedas + | PSR | DSR (N tabla) | DSR (N declarado) | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agente Liquidez + Perfil + Supertrend + EMAs | 4h | 4 | 75,0 % | 100,0 % | 75,0 % | 50,0 % | 25,0 % | 4,92 | +0,988 R (-0,175 R a +2,150 R) | 1,01 R | 3/3 | 82,4 % | 65,6 % | 57,6 % | SIN CONCLUSIÓN |
| Agente Liquidez + Perfil + Supertrend + EMAs | 1h | 29 | 48,3 % | 55,2 % | 37,9 % | 34,5 % | 41,4 % | 1,51 | +0,248 R (-0,163 R a +0,658 R) | 6,24 R | 5/10 | 84,2 % | 12,4 % | 2,2 % | SIN CONCLUSIÓN |
| Agente Supertrend MTF + Volumen | 4h | 227 | 51,1 % | 58,6 % | 37,0 % | 25,1 % | 38,8 % | 1,54 | +0,237 R (+0,102 R a +0,371 R) | 13,42 R | 9/10 | 99,9 % | 0,1 % | 0,0 % | CANDIDATA |
| Agente Liquidez + IFVG + Breaker | 4h | 58 | 48,3 % | 60,3 % | 39,7 % | 24,1 % | 44,8 % | 1,39 | +0,187 R (-0,089 R a +0,462 R) | 6,21 R | 6/10 | 87,2 % | 2,6 % | 0,1 % | SIN CONCLUSIÓN |
| Agente Supertrend | 4h | 438 | 48,6 % | 59,1 % | 35,4 % | 22,8 % | 40,0 % | 1,37 | +0,169 R (+0,074 R a +0,263 R) | 21,41 R | 10/10 | 99,9 % | 0,0 % | 0,0 % | CANDIDATA |
| Agente Supertrend + VWAP | 4h | 434 | 48,2 % | 58,8 % | 35,3 % | 22,8 % | 40,1 % | 1,36 | +0,164 R (+0,069 R a +0,260 R) | 21,41 R | 10/10 | 99,8 % | 0,0 % | 0,0 % | CANDIDATA |
| Agente Supertrend + Perfil | 4h | 374 | 46,3 % | 56,4 % | 35,0 % | 23,5 % | 41,7 % | 1,29 | +0,134 R (+0,031 R a +0,238 R) | 19,57 R | 9/10 | 98,6 % | 0,0 % | 0,0 % | CANDIDATA |
| Agente Supertrend + VWAP + Perfil | 4h | 371 | 46,1 % | 56,3 % | 35,0 % | 23,5 % | 41,5 % | 1,29 | +0,134 R (+0,030 R a +0,238 R) | 19,57 R | 9/10 | 98,5 % | 0,0 % | 0,0 % | CANDIDATA |
| Agente Supertrend MTF | 4h | 375 | 46,1 % | 56,5 % | 34,7 % | 21,9 % | 41,9 % | 1,27 | +0,128 R (+0,026 R a +0,231 R) | 21,22 R | 10/10 | 98,2 % | 0,0 % | 0,0 % | CANDIDATA |
| Agente Línea de tendencia | 4h | 947 | 38,4 % | 62,2 % | 45,0 % | 35,2 % | 60,9 % | 1,09 | +0,057 R (-0,020 R a +0,133 R) | 63,50 R | 5/10 | 89,2 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Ruptura | 1h | 4070 | 42,6 % | 55,2 % | 32,6 % | 20,9 % | 40,5 % | 1,06 | +0,030 R (-0,000 R a +0,060 R) | 77,13 R | 6/10 | 94,9 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Ruptura | 4h | 1026 | 41,2 % | 58,0 % | 33,0 % | 19,2 % | 43,5 % | 1,02 | +0,008 R (-0,051 R a +0,068 R) | 42,33 R | 7/10 | 59,2 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Tendencia | 4h | 765 | 36,5 % | 59,2 % | 44,4 % | 34,0 % | 63,3 % | 1,01 | +0,004 R (-0,080 R a +0,088 R) | 72,66 R | 5/10 | 52,9 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Momento | 4h | 1231 | 36,1 % | 60,2 % | 43,3 % | 34,2 % | 63,5 % | 1,00 | +0,001 R (-0,066 R a +0,067 R) | 61,09 R | 5/10 | 50,7 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Control (azar) | 1h | 2895 | 38,1 % | 63,6 % | 46,0 % | 34,8 % | 60,5 % | 0,99 | -0,010 R (-0,053 R a +0,034 R) | 183,13 R | 7/10 | — | — | — | CONTROL |
| Agente Momento MTF + SNR | 15m | 136 | 41,2 % | 62,5 % | 45,6 % | 40,4 % | 58,8 % | 0,98 | -0,012 R (-0,223 R a +0,199 R) | 12,79 R | 5/10 | 46,4 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Supertrend + Perfil | 1h | 1580 | 40,4 % | 54,0 % | 31,1 % | 19,6 % | 43,6 % | 0,97 | -0,014 R (-0,062 R a +0,035 R) | 69,43 R | 4/10 | 31,9 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Retroceso | 4h | 1624 | 35,2 % | 59,8 % | 42,0 % | 33,6 % | 64,1 % | 0,97 | -0,017 R (-0,075 R a +0,041 R) | 95,38 R | 6/10 | 31,4 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Supertrend + VWAP | 1h | 1630 | 40,9 % | 54,1 % | 31,0 % | 19,0 % | 43,4 % | 0,97 | -0,018 R (-0,065 R a +0,030 R) | 65,14 R | 4/10 | 27,1 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Control (azar) | 4h | 766 | 35,4 % | 58,2 % | 43,9 % | 32,6 % | 63,7 % | 0,97 | -0,020 R (-0,104 R a +0,063 R) | 61,55 R | 4/10 | — | — | — | CONTROL |
| Agente Supertrend + VWAP + Perfil | 1h | 1481 | 40,1 % | 53,9 % | 30,9 % | 19,1 % | 43,7 % | 0,96 | -0,023 R (-0,073 R a +0,027 R) | 62,17 R | 4/10 | 22,3 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Supertrend | 1h | 1783 | 40,5 % | 53,4 % | 30,3 % | 19,0 % | 44,4 % | 0,94 | -0,031 R (-0,076 R a +0,014 R) | 95,51 R | 4/10 | 13,2 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Supertrend MTF | 1h | 1426 | 40,0 % | 54,1 % | 30,9 % | 18,3 % | 44,9 % | 0,92 | -0,043 R (-0,093 R a +0,008 R) | 103,71 R | 4/10 | 8,4 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Supertrend MTF + Volumen | 1h | 870 | 39,7 % | 54,6 % | 30,1 % | 17,2 % | 43,1 % | 0,91 | -0,047 R (-0,110 R a +0,016 R) | 61,42 R | 5/10 | 11,5 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Bandas | 4h | 2257 | 40,5 % | 66,1 % | 49,8 % | 39,4 % | 59,0 % | 0,92 | -0,049 R (-0,091 R a -0,007 R) | 159,23 R | 3/10 | 2,8 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Reversión | 4h | 1182 | 40,1 % | 65,0 % | 48,1 % | 38,3 % | 59,0 % | 0,91 | -0,058 R (-0,116 R a -0,000 R) | 96,27 R | 3/10 | 5,1 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Liquidez + IFVG + Breaker | 1h | 223 | 42,2 % | 50,7 % | 31,8 % | 18,4 % | 48,4 % | 0,89 | -0,059 R (-0,187 R a +0,069 R) | 29,91 R | 2/10 | 23,0 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Línea de tendencia | 1h | 3474 | 35,5 % | 60,2 % | 43,0 % | 32,5 % | 63,2 % | 0,88 | -0,085 R (-0,124 R a -0,046 R) | 319,06 R | 1/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Fibonacci + Niveles clave | 4h | 349 | 33,8 % | 28,7 % | 20,9 % | 14,6 % | 55,9 % | 0,86 | -0,090 R (-0,213 R a +0,033 R) | 45,77 R | 5/10 | 12,5 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Momento | 1h | 4998 | 34,9 % | 59,9 % | 43,2 % | 33,1 % | 64,1 % | 0,87 | -0,093 R (-0,126 R a -0,061 R) | 479,56 R | 1/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Fibonacci + Niveles clave | 15m | 1289 | 36,3 % | 36,3 % | 25,8 % | 16,1 % | 53,8 % | 0,84 | -0,104 R (-0,170 R a -0,038 R) | 163,15 R | 2/10 | 0,6 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Retroceso | 1h | 6518 | 34,2 % | 58,8 % | 42,3 % | 32,0 % | 64,9 % | 0,84 | -0,118 R (-0,146 R a -0,090 R) | 779,65 R | 1/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Tendencia | 1h | 3106 | 34,2 % | 59,6 % | 42,1 % | 31,7 % | 64,5 % | 0,83 | -0,121 R (-0,162 R a -0,080 R) | 404,16 R | 2/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Bandas | 1h | 8677 | 39,7 % | 65,8 % | 49,0 % | 38,4 % | 59,7 % | 0,80 | -0,134 R (-0,155 R a -0,112 R) | 1172,86 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Reversión | 1h | 4368 | 38,6 % | 64,0 % | 47,3 % | 37,2 % | 60,6 % | 0,77 | -0,155 R (-0,185 R a -0,125 R) | 707,08 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Fibonacci + Niveles clave | 1h | 620 | 34,4 % | 30,5 % | 22,6 % | 12,7 % | 55,8 % | 0,75 | -0,157 R (-0,243 R a -0,070 R) | 102,41 R | 2/10 | 0,3 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Momento MTF + SNR | 4h | 57 | 28,1 % | 56,1 % | 36,8 % | 28,1 % | 71,9 % | 0,72 | -0,215 R (-0,511 R a +0,081 R) | 12,95 R | 3/10 | 13,6 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Línea de tendencia | 15m | 14334 | 35,3 % | 60,6 % | 43,4 % | 32,6 % | 63,4 % | 0,71 | -0,231 R (-0,251 R a -0,212 R) | 3317,11 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente SNR + Storyline | 4h | 4154 | 32,0 % | 48,3 % | 38,4 % | 31,6 % | 67,8 % | 0,66 | -0,288 R (-0,326 R a -0,251 R) | 1221,55 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Liquidez + IFVG + Breaker | 15m | 832 | 33,2 % | 48,2 % | 25,5 % | 13,3 % | 54,3 % | 0,55 | -0,291 R (-0,353 R a -0,229 R) | 245,46 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Control (azar) | 15m | 11260 | 32,9 % | 58,1 % | 41,0 % | 30,6 % | 65,6 % | 0,65 | -0,294 R (-0,316 R a -0,272 R) | 3342,13 R | 0/10 | — | — | — | CONTROL |
| Agente SNR | 4h | 5758 | 31,0 % | 47,8 % | 37,8 % | 30,5 % | 68,7 % | 0,64 | -0,314 R (-0,345 R a -0,283 R) | 1828,24 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Momento MTF + SNR | 1h | 114 | 26,3 % | 50,0 % | 35,1 % | 24,6 % | 71,1 % | 0,59 | -0,326 R (-0,526 R a -0,126 R) | 39,82 R | 1/10 | 0,9 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Liquidez + Perfil + Supertrend + EMAs | 15m | 43 | 32,6 % | 48,8 % | 27,9 % | 11,6 % | 60,5 % | 0,46 | -0,378 R (-0,649 R a -0,108 R) | 16,27 R | 2/9 | 2,9 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| Agente Momento MTF + SNR | 3m | 290 | 33,4 % | 59,0 % | 39,7 % | 33,1 % | 65,5 % | 0,54 | -0,440 R (-0,581 R a -0,299 R) | 127,76 R | 1/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente SNR + Storyline | 1h | 16713 | 30,7 % | 48,2 % | 38,1 % | 30,9 % | 68,5 % | 0,45 | -0,588 R (-0,612 R a -0,565 R) | 9835,11 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente SNR | 1h | 23588 | 30,5 % | 48,1 % | 37,6 % | 30,7 % | 68,7 % | 0,45 | -0,596 R (-0,615 R a -0,576 R) | 14056,05 R | 0/10 | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |
| Agente Control (azar) | 3m | 59078 | 33,3 % | 59,8 % | 43,3 % | 32,8 % | 64,4 % | 0,40 | -0,669 R (-0,679 R a -0,658 R) | 39524,26 R | 0/10 | — | — | — | CONTROL |

## Auditoría de sobreajuste

PSR: probabilidad de que el R medio por operación sea mayor que cero, descontando asimetría y colas gordas. DSR: lo mismo, pero contra el mejor resultado que se esperaría solo por azar al elegir entre N variantes (Bailey y López de Prado). N tabla = 44 variantes de esta tabla; N declarado = 600, que suma la grilla SNR (128), pruebas sueltas y las búsquedas de confirmación y configuración de la línea de tendencia y del breaker block (99 cada una, en docs/busqueda-linea.md y docs/busqueda-breaker.md) la del agente de liquidez (108, en docs/busqueda-smc.md) y la del agente Fibonacci (57, en docs/busqueda-fibonacci.md), sobre los mismos datos. Un DSR menor a 95 % no alcanza para decir que hay ventaja.

Reality Check de White y SPA de Hansen sobre el resultado diario de las 44 variantes en evaluación (740 días, bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = 0,88 (Reality Check) y p = 0,34 (SPA). La pregunta que responden: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí.

Advertencia: la evaluación ya se miró al diseñar las variantes (la MTF + Volumen nació después de ver el Supertrend). Ningún número de esta tabla es una prueba limpia: la única es la medición hacia adelante del agente en papel. El Agente Línea de tendencia (TENDENCIA_LINEA) se mide con parámetros fijos: pivotes de 5 velas, ruptura de 0,1 ATR, stop a 1,5 ATR, objetivo de 2 R y sin confirmación. Se mide en 1 h, 4 h y 15 min. Después se buscó su mejor confirmación y configuración con reglas de desarrollo (docs/busqueda-linea.md); esas variantes ya cuentan en el N declarado. El Agente Liquidez + IFVG + Breaker (SMC_LIQUIDEZ) también se mide con configuración fijada de antemano (toma de liquidez, IFVG y breaker; zonas FVG y OB; margen 0,5 ATR; objetivo 2 R) en 1 h, 4 h y 15 min; su búsqueda de disparo y configuración está en docs/busqueda-smc.md y ya cuenta en el N declarado. El Agente Fibonacci + Niveles clave (FIB_NIVELES) se mide también con configuración fijada de antemano (retroceso 0,618–0,786, con nivel clave del día o la semana anteriores, y objetivos TP1 1, TP2 1,272 y TP3 1,618 de la extensión) en 1 h, 4 h y 15 min; su búsqueda está en docs/busqueda-fibonacci.md. El Agente Liquidez + IFVG + Breaker (SMC_LIQUIDEZ) también se mide con configuración fijada de antemano (disparo con toma de liquidez, IFVG y breaker; zonas FVG y OB; margen 0,5 ATR; objetivo 2 R) en 1 h, 4 h y 15 min; su búsqueda de disparo y configuración está en docs/busqueda-smc.md y ya cuenta en el N declarado.

## Desarrollo (para comparar: si gana acá y pierde en evaluación, no se sostiene)

| Agente | Velas | Operaciones | Acierto | TP1 | TP2 | TP3 | SL | Profit factor | Expectancia |
|---|---|---|---|---|---|---|---|---|---|
| Agente Ruptura | 1h | 9176 | 41,8 % | 54,0 % | 31,7 % | 19,6 % | 42,9 % | 1,00 | -0,001 R |
| Agente Tendencia | 1h | 6676 | 36,2 % | 61,2 % | 43,8 % | 33,0 % | 62,3 % | 0,93 | -0,048 R |
| Agente Reversión | 1h | 9794 | 38,4 % | 64,6 % | 47,2 % | 36,4 % | 60,8 % | 0,79 | -0,137 R |
| Agente Bandas | 1h | 19950 | 39,4 % | 65,2 % | 48,3 % | 37,6 % | 59,7 % | 0,82 | -0,116 R |
| Agente Retroceso | 1h | 14758 | 35,0 % | 58,9 % | 41,8 % | 31,8 % | 63,5 % | 0,89 | -0,076 R |
| Agente Momento | 1h | 11484 | 35,2 % | 59,5 % | 42,5 % | 32,9 % | 63,7 % | 0,91 | -0,065 R |
| Agente Momento MTF + SNR | 1h | 256 | 35,9 % | 64,5 % | 45,7 % | 32,4 % | 62,9 % | 0,91 | -0,061 R |
| Agente Supertrend | 1h | 3811 | 44,0 % | 55,2 % | 32,0 % | 19,2 % | 39,9 % | 1,09 | +0,044 R |
| Agente Supertrend + VWAP | 1h | 3503 | 45,0 % | 55,9 % | 32,5 % | 20,0 % | 39,2 % | 1,15 | +0,069 R |
| Agente Supertrend + Perfil | 1h | 3382 | 44,4 % | 55,5 % | 32,2 % | 19,2 % | 39,9 % | 1,11 | +0,050 R |
| Agente Supertrend + VWAP + Perfil | 1h | 3219 | 45,4 % | 56,4 % | 33,0 % | 20,2 % | 39,2 % | 1,17 | +0,078 R |
| Agente Supertrend MTF | 1h | 2932 | 44,2 % | 56,0 % | 33,4 % | 20,4 % | 41,1 % | 1,12 | +0,056 R |
| Agente Supertrend MTF + Volumen | 1h | 1923 | 45,4 % | 56,4 % | 33,7 % | 20,3 % | 38,7 % | 1,18 | +0,085 R |
| Agente SNR | 1h | 53349 | 30,2 % | 47,8 % | 37,1 % | 29,8 % | 69,3 % | 0,38 | -0,806 R |
| Agente SNR + Storyline | 1h | 38746 | 30,7 % | 48,1 % | 37,6 % | 30,4 % | 68,8 % | 0,42 | -0,692 R |
| Agente Línea de tendencia | 1h | 8485 | 36,0 % | 61,6 % | 43,9 % | 32,4 % | 62,4 % | 0,92 | -0,053 R |
| Agente Liquidez + IFVG + Breaker | 1h | 470 | 40,9 % | 54,0 % | 31,5 % | 19,1 % | 41,9 % | 1,00 | +0,001 R |
| Agente Liquidez + Perfil + Supertrend + EMAs | 1h | 77 | 28,6 % | 46,8 % | 27,3 % | 15,6 % | 58,4 % | 0,61 | -0,258 R |
| Agente Fibonacci + Niveles clave | 1h | 1493 | 39,5 % | 31,3 % | 21,3 % | 13,9 % | 51,3 % | 0,96 | -0,020 R |
| Agente Control (azar) | 1h | 6583 | 35,1 % | 62,2 % | 43,6 % | 30,8 % | 63,7 % | 0,87 | -0,088 R |
| Agente Ruptura | 4h | 2307 | 44,2 % | 57,3 % | 35,3 % | 22,4 % | 41,6 % | 1,21 | +0,099 R |
| Agente Tendencia | 4h | 1661 | 37,4 % | 62,1 % | 45,6 % | 34,5 % | 61,4 % | 1,07 | +0,044 R |
| Agente Reversión | 4h | 2648 | 37,2 % | 65,0 % | 47,2 % | 35,3 % | 62,1 % | 0,81 | -0,123 R |
| Agente Bandas | 4h | 5021 | 40,5 % | 65,9 % | 49,6 % | 38,7 % | 59,1 % | 0,93 | -0,045 R |
| Agente Retroceso | 4h | 3478 | 36,7 % | 60,7 % | 43,4 % | 32,8 % | 61,8 % | 1,02 | +0,015 R |
| Agente Momento | 4h | 2767 | 37,0 % | 63,2 % | 44,5 % | 34,3 % | 61,8 % | 1,06 | +0,040 R |
| Agente Momento MTF + SNR | 4h | 180 | 41,7 % | 66,7 % | 51,7 % | 40,6 % | 58,3 % | 1,32 | +0,195 R |
| Agente Supertrend | 4h | 938 | 43,9 % | 52,9 % | 30,3 % | 19,2 % | 41,6 % | 1,07 | +0,035 R |
| Agente Supertrend + VWAP | 4h | 928 | 44,1 % | 53,1 % | 30,5 % | 19,4 % | 41,6 % | 1,08 | +0,039 R |
| Agente Supertrend + Perfil | 4h | 813 | 45,5 % | 55,0 % | 33,6 % | 21,5 % | 41,7 % | 1,18 | +0,088 R |
| Agente Supertrend + VWAP + Perfil | 4h | 804 | 45,5 % | 55,1 % | 33,8 % | 21,8 % | 41,9 % | 1,19 | +0,090 R |
| Agente Supertrend MTF | 4h | 812 | 46,1 % | 55,8 % | 34,0 % | 21,1 % | 39,8 % | 1,21 | +0,099 R |
| Agente Supertrend MTF + Volumen | 4h | 483 | 47,4 % | 56,1 % | 35,8 % | 23,4 % | 36,6 % | 1,40 | +0,175 R |
| Agente SNR | 4h | 13448 | 30,4 % | 48,0 % | 37,2 % | 29,9 % | 69,3 % | 0,66 | -0,282 R |
| Agente SNR + Storyline | 4h | 9597 | 31,4 % | 48,5 % | 38,2 % | 30,8 % | 68,4 % | 0,69 | -0,255 R |
| Agente Línea de tendencia | 4h | 2051 | 37,9 % | 64,3 % | 45,2 % | 34,1 % | 60,1 % | 1,09 | +0,057 R |
| Agente Liquidez + IFVG + Breaker | 4h | 140 | 49,3 % | 57,1 % | 27,1 % | 17,9 % | 37,9 % | 1,28 | +0,116 R |
| Agente Liquidez + Perfil + Supertrend + EMAs | 4h | 19 | 42,1 % | 63,2 % | 42,1 % | 15,8 % | 47,4 % | 0,99 | -0,005 R |
| Agente Fibonacci + Niveles clave | 4h | 830 | 36,4 % | 32,2 % | 23,1 % | 15,8 % | 54,5 % | 0,94 | -0,033 R |
| Agente Control (azar) | 4h | 1754 | 34,2 % | 55,9 % | 38,9 % | 30,0 % | 64,7 % | 0,90 | -0,066 R |
| Agente Momento MTF + SNR | 15m | 60 | 23,3 % | 56,7 % | 33,3 % | 21,7 % | 76,7 % | 0,42 | -0,522 R |
| Agente Línea de tendencia | 15m | 5156 | 34,9 % | 60,5 % | 42,8 % | 32,3 % | 63,9 % | 0,72 | -0,225 R |
| Agente Liquidez + IFVG + Breaker | 15m | 270 | 37,8 % | 45,2 % | 27,0 % | 17,8 % | 46,3 % | 0,77 | -0,129 R |
| Agente Liquidez + Perfil + Supertrend + EMAs | 15m | 22 | 36,4 % | 63,6 % | 36,4 % | 22,7 % | 40,9 % | 0,92 | -0,041 R |
| Agente Fibonacci + Niveles clave | 15m | 458 | 32,8 % | 32,8 % | 23,8 % | 15,3 % | 56,1 % | 0,74 | -0,176 R |
| Agente Control (azar) | 15m | 3981 | 34,8 % | 60,5 % | 42,2 % | 31,4 % | 63,6 % | 0,71 | -0,234 R |
| Agente Momento MTF + SNR | 3m | 103 | 35,9 % | 61,2 % | 44,7 % | 35,0 % | 63,1 % | 0,57 | -0,422 R |
| Agente Control (azar) | 3m | 20751 | 34,1 % | 60,0 % | 43,6 % | 33,1 % | 63,4 % | 0,43 | -0,608 R |
