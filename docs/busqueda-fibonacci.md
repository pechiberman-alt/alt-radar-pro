# Búsqueda de configuración: Fibonacci + extensión + niveles clave

Generado el 2026-10-14 con `scripts/investigacion/fib-busqueda.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min, del 2020-01-01 al 2026-09-30. Desarrollo hasta el 2024-09-21, evaluación después: el mismo corte del estudio (`docs/estudio-estrategias.md`). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Qué se midió

Se toma la última pierna de impulso (de un pivote de 5 velas al siguiente de signo contrario, de al menos 2 ATR; se conoce al confirmarse el pivote y vive 80 velas o hasta que el precio la rompe). Se espera el retroceso a la zona de Fibonacci y se entra en la primera vela que la toca y cierra a favor, sin cerrar más allá de la zona. Stop a 0,25 ATR del origen de la pierna (si queda a más de 4 ATR no se opera). Objetivo: la extensión de la pierna (1 = volver al extremo del impulso; 1,272 y 1,618 más allá). Con nivel clave, además, el máximo o el mínimo del día o de la semana anteriores (UTC) tiene que caer dentro de la zona, a 0,25 ATR o menos. Una señal por pierna.

- **Grilla** (18 por temporalidad): zona 0,5–0,618, 0,618–0,786 o 0,5–0,786 × extensión 1, 1,272 o 1,618 × con o sin nivel clave.
- **El agente** se fijó de antemano con la convención clásica (bolsillo dorado 0,618–0,786, con nivel clave) y su escalera propia: TP1 en la extensión 1 (volver al extremo del impulso), TP2 en 1,272 y TP3 en 1,618; el TP3 es el objetivo que se mide. No se eligió con estos resultados y no está en la grilla (que tiene un solo objetivo con TP1 y TP2 a un tercio y dos tercios): es la variante 19 de cada temporalidad.
- **Elección** (solo con el DESARROLLO): candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una); gana el piso más alto del intervalo del 90 %. Sin candidatas, se muestra la de piso más alto, marcada como no estable.
- **Contabilidad**: 18 de la grilla más el agente, 19 por temporalidad y 57 en total; el DSR de la búsqueda cuenta esas 57; el declarado del estudio pasa a 600 (469 de antes como mínimo, más estas 57, redondeado para arriba).

## Cómo leerlo

- Todo lo de desarrollo se eligió sin mirar la evaluación, pero **el período de evaluación ya se miró** con otras estrategias y búsquedas: los números de evaluación no son una prueba limpia.
- Los umbrales (pivotes de 5, pierna de 2 ATR, vida de 80, margen de 0,25 ATR, tolerancia de 0,25 ATR, riesgo máximo de 4 ATR) son fijos: no se afinaron.
- La detección es propia y causal: no usa los detectores del gráfico, que miran velas posteriores. Los niveles clave son del día y la semana ya cerrados.
- Los intervalos son del 90 %. Un intervalo que cruza cero no da conclusión. Es una medición del pasado, con costos; no garantiza resultados futuros y no es asesoramiento financiero.

## Resumen por temporalidad

- **1h**: Ninguna configuración es estable en el desarrollo; la de mayor piso es zona 0,618-0,786 · extensión 1,618 · con nivel clave (marcada no estable): en evaluación 620 operaciones, expectancia -0,157 R (IC -0,243 R a -0,070 R), veredicto SIN VENTAJA. El agente (configuración fijada de antemano, zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618): 620 operaciones en evaluación, acierto 34,4 %, profit factor 0,75, expectancia -0,157 R (IC -0,243 R a -0,070 R).
- **4h**: La regla de desarrollo eligió zona 0,5-0,618 · extensión 1,618 · con nivel clave: 735 operaciones en desarrollo con +0,057 R (IC -0,014 R a +0,128 R); en evaluación 291 operaciones, acierto 43,6 %, profit factor 1,12, expectancia +0,062 R (IC -0,056 R a +0,180 R), DSR con N = 57: 19,8 %. Veredicto: SIN CONCLUSIÓN. El agente (configuración fijada de antemano, zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618): 349 operaciones en evaluación, acierto 33,8 %, profit factor 0,86, expectancia -0,090 R (IC -0,213 R a +0,033 R).
- **15m**: Ninguna configuración es estable en el desarrollo; la de mayor piso es zona 0,5-0,618 · extensión 1,272 · sin nivel clave (marcada no estable): en evaluación 7221 operaciones, expectancia -0,123 R (IC -0,143 R a -0,102 R), veredicto SIN VENTAJA. El agente (configuración fijada de antemano, zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618): 1289 operaciones en evaluación, acierto 36,3 %, profit factor 0,84, expectancia -0,104 R (IC -0,170 R a -0,038 R).

## Auditoría de sobreajuste

Variantes de la búsqueda: 57. Ensayos declarados del estudio: 600. Varianza de los Sharpe por operación entre las variantes en evaluación: 0,0018.

| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |
|---|---|---|---|---|---|
| 1h | zona 0,618-0,786 · extensión 1,618 · con nivel clave | 0,3 % | 0,0 % | 0,0 % | SIN VENTAJA |
| 4h | zona 0,5-0,618 · extensión 1,618 · con nivel clave | 81,0 % | 19,8 % | 7,7 % | SIN CONCLUSIÓN |
| 15m | zona 0,5-0,618 · extensión 1,272 · sin nivel clave | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |

Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las 57 variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = 0,96 (Reality Check) y p = 0,77 (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí.

## 1h: las 18 configuraciones y el agente

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Acierto | Profit factor | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|---|---|
| zona 0,5-0,618 · extensión 1 · sin nivel clave | 4638 | 51,4 % | 0,79 | -0,096 R (-0,117 R a -0,075 R) | -0,100 R / -0,092 R | 1965 | 53,7 % | 0,85 | -0,067 R (-0,100 R a -0,034 R) | no |
| zona 0,5-0,618 · extensión 1,272 · sin nivel clave | 4126 | 44,0 % | 0,86 | -0,073 R (-0,099 R a -0,046 R) | -0,066 R / -0,079 R | 1723 | 46,5 % | 0,96 | -0,019 R (-0,061 R a +0,024 R) | no |
| zona 0,5-0,618 · extensión 1,618 · sin nivel clave | 3811 | 39,8 % | 0,90 | -0,057 R (-0,088 R a -0,025 R) | -0,024 R / -0,087 R | 1581 | 40,4 % | 0,95 | -0,027 R (-0,078 R a +0,023 R) | no |
| zona 0,618-0,786 · extensión 1 · sin nivel clave | 4609 | 43,3 % | 0,81 | -0,109 R (-0,136 R a -0,083 R) | -0,089 R / -0,128 R | 1983 | 44,6 % | 0,85 | -0,082 R (-0,124 R a -0,040 R) | no |
| zona 0,618-0,786 · extensión 1,272 · sin nivel clave | 4276 | 38,3 % | 0,85 | -0,092 R (-0,124 R a -0,060 R) | -0,056 R / -0,124 R | 1822 | 40,5 % | 0,95 | -0,029 R (-0,080 R a +0,021 R) | no |
| zona 0,618-0,786 · extensión 1,618 · sin nivel clave | 4059 | 35,8 % | 0,90 | -0,065 R (-0,101 R a -0,028 R) | -0,015 R / -0,110 R | 1713 | 36,3 % | 0,94 | -0,041 R (-0,100 R a +0,017 R) | no |
| zona 0,5-0,786 · extensión 1 · sin nivel clave | 5107 | 47,7 % | 0,80 | -0,104 R (-0,127 R a -0,081 R) | -0,102 R / -0,106 R | 2190 | 49,8 % | 0,86 | -0,070 R (-0,107 R a -0,034 R) | no |
| zona 0,5-0,786 · extensión 1,272 · sin nivel clave | 4556 | 41,2 % | 0,85 | -0,084 R (-0,112 R a -0,055 R) | -0,069 R / -0,097 R | 1924 | 43,6 % | 0,97 | -0,016 R (-0,062 R a +0,030 R) | no |
| zona 0,5-0,786 · extensión 1,618 · sin nivel clave | 4206 | 37,6 % | 0,90 | -0,061 R (-0,095 R a -0,027 R) | -0,031 R / -0,089 R | 1757 | 38,3 % | 0,95 | -0,030 R (-0,084 R a +0,024 R) | no |
| zona 0,5-0,618 · extensión 1 · con nivel clave | 1136 | 51,7 % | 0,81 | -0,085 R (-0,127 R a -0,042 R) | -0,107 R / -0,063 R | 452 | 52,4 % | 0,78 | -0,104 R (-0,173 R a -0,036 R) | no |
| zona 0,5-0,618 · extensión 1,272 · con nivel clave | 1113 | 45,5 % | 0,90 | -0,048 R (-0,099 R a +0,003 R) | -0,061 R / -0,035 R | 444 | 44,4 % | 0,84 | -0,087 R (-0,169 R a -0,004 R) | no |
| zona 0,5-0,618 · extensión 1,618 · con nivel clave | 1090 | 41,3 % | 0,91 | -0,046 R (-0,103 R a +0,012 R) | -0,045 R / -0,046 R | 438 | 37,9 % | 0,80 | -0,116 R (-0,210 R a -0,022 R) | no |
| zona 0,618-0,786 · extensión 1 · con nivel clave | 1532 | 44,6 % | 0,88 | -0,061 R (-0,107 R a -0,015 R) | -0,059 R / -0,064 R | 638 | 41,7 % | 0,75 | -0,140 R (-0,210 R a -0,070 R) | no |
| zona 0,618-0,786 · extensión 1,272 · con nivel clave | 1508 | 41,0 % | 0,91 | -0,048 R (-0,100 R a +0,004 R) | -0,035 R / -0,060 R | 627 | 38,8 % | 0,85 | -0,088 R (-0,169 R a -0,006 R) | no |
| **zona 0,618-0,786 · extensión 1,618 · con nivel clave** | 1493 | 39,5 % | 0,96 | -0,020 R (-0,079 R a +0,038 R) | +0,009 R / -0,048 R | 620 | 34,4 % | 0,75 | -0,157 R (-0,243 R a -0,070 R) | no |
| zona 0,5-0,786 · extensión 1 · con nivel clave | 2217 | 47,1 % | 0,82 | -0,088 R (-0,123 R a -0,053 R) | -0,112 R / -0,066 R | 948 | 47,4 % | 0,79 | -0,106 R (-0,160 R a -0,052 R) | no |
| zona 0,5-0,786 · extensión 1,272 · con nivel clave | 2138 | 42,0 % | 0,88 | -0,064 R (-0,105 R a -0,023 R) | -0,077 R / -0,052 R | 917 | 41,8 % | 0,87 | -0,075 R (-0,139 R a -0,012 R) | no |
| zona 0,5-0,786 · extensión 1,618 · con nivel clave | 2067 | 38,6 % | 0,92 | -0,045 R (-0,093 R a +0,002 R) | -0,049 R / -0,043 R | 892 | 37,2 % | 0,85 | -0,092 R (-0,164 R a -0,021 R) | no |
| *zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618* (agente) | 1493 | 39,5 % | 0,96 | -0,020 R (-0,079 R a +0,038 R) | +0,009 R / -0,048 R | 620 | 34,4 % | 0,75 | -0,157 R (-0,243 R a -0,070 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,010 R sobre 2895 operaciones.

## 4h: las 18 configuraciones y el agente

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Acierto | Profit factor | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|---|---|
| zona 0,5-0,618 · extensión 1 · sin nivel clave | 1194 | 51,6 % | 0,85 | -0,066 R (-0,106 R a -0,025 R) | -0,016 R / -0,120 R | 492 | 51,2 % | 0,84 | -0,075 R (-0,142 R a -0,008 R) | no |
| zona 0,5-0,618 · extensión 1,272 · sin nivel clave | 1048 | 46,3 % | 0,95 | -0,021 R (-0,072 R a +0,030 R) | +0,036 R / -0,085 R | 446 | 43,7 % | 0,87 | -0,066 R (-0,150 R a +0,017 R) | no |
| zona 0,5-0,618 · extensión 1,618 · sin nivel clave | 983 | 43,3 % | 1,07 | +0,036 R (-0,025 R a +0,096 R) | +0,111 R / -0,046 R | 414 | 40,1 % | 0,91 | -0,047 R (-0,145 R a +0,051 R) | no |
| zona 0,618-0,786 · extensión 1 · sin nivel clave | 1136 | 43,6 % | 0,83 | -0,091 R (-0,144 R a -0,039 R) | -0,081 R / -0,102 R | 484 | 42,1 % | 0,84 | -0,087 R (-0,170 R a -0,004 R) | no |
| zona 0,618-0,786 · extensión 1,272 · sin nivel clave | 1040 | 39,0 % | 0,87 | -0,075 R (-0,138 R a -0,013 R) | -0,058 R / -0,094 R | 455 | 37,1 % | 0,88 | -0,070 R (-0,168 R a +0,028 R) | no |
| zona 0,618-0,786 · extensión 1,618 · sin nivel clave | 999 | 36,8 % | 0,95 | -0,029 R (-0,102 R a +0,044 R) | +0,001 R / -0,062 R | 435 | 34,3 % | 0,93 | -0,043 R (-0,158 R a +0,072 R) | no |
| zona 0,5-0,786 · extensión 1 · sin nivel clave | 1326 | 47,9 % | 0,84 | -0,078 R (-0,122 R a -0,035 R) | -0,037 R / -0,123 R | 540 | 47,8 % | 0,85 | -0,074 R (-0,146 R a -0,002 R) | no |
| zona 0,5-0,786 · extensión 1,272 · sin nivel clave | 1165 | 43,3 % | 0,94 | -0,029 R (-0,083 R a +0,025 R) | +0,016 R / -0,078 R | 488 | 40,6 % | 0,86 | -0,081 R (-0,168 R a +0,006 R) | no |
| zona 0,5-0,786 · extensión 1,618 · sin nivel clave | 1091 | 40,6 % | 1,05 | +0,027 R (-0,037 R a +0,092 R) | +0,100 R / -0,052 R | 451 | 36,8 % | 0,88 | -0,069 R (-0,171 R a +0,034 R) | no |
| zona 0,5-0,618 · extensión 1 · con nivel clave | 825 | 52,0 % | 0,90 | -0,041 R (-0,090 R a +0,008 R) | -0,023 R / -0,063 R | 328 | 53,0 % | 0,93 | -0,029 R (-0,110 R a +0,052 R) | no |
| zona 0,5-0,618 · extensión 1,272 · con nivel clave | 769 | 46,2 % | 0,99 | -0,003 R (-0,063 R a +0,057 R) | +0,033 R / -0,046 R | 310 | 46,5 % | 1,03 | +0,012 R (-0,087 R a +0,112 R) | no |
| **zona 0,5-0,618 · extensión 1,618 · con nivel clave** | 735 | 43,1 % | 1,12 | +0,057 R (-0,014 R a +0,128 R) | +0,100 R / +0,005 R | 291 | 43,6 % | 1,12 | +0,062 R (-0,056 R a +0,180 R) | sí |
| zona 0,618-0,786 · extensión 1 · con nivel clave | 904 | 42,4 % | 0,79 | -0,113 R (-0,171 R a -0,055 R) | -0,085 R / -0,141 R | 386 | 41,5 % | 0,79 | -0,118 R (-0,209 R a -0,027 R) | no |
| zona 0,618-0,786 · extensión 1,272 · con nivel clave | 856 | 38,0 % | 0,85 | -0,086 R (-0,154 R a -0,017 R) | -0,018 R / -0,154 R | 365 | 36,2 % | 0,80 | -0,119 R (-0,225 R a -0,013 R) | no |
| zona 0,618-0,786 · extensión 1,618 · con nivel clave | 830 | 36,4 % | 0,94 | -0,033 R (-0,113 R a +0,047 R) | +0,058 R / -0,124 R | 349 | 33,8 % | 0,86 | -0,090 R (-0,213 R a +0,033 R) | no |
| zona 0,5-0,786 · extensión 1 · con nivel clave | 1170 | 47,8 % | 0,84 | -0,077 R (-0,123 R a -0,031 R) | -0,022 R / -0,137 R | 477 | 47,4 % | 0,84 | -0,082 R (-0,157 R a -0,007 R) | no |
| zona 0,5-0,786 · extensión 1,272 · con nivel clave | 1056 | 42,8 % | 0,92 | -0,040 R (-0,096 R a +0,016 R) | +0,033 R / -0,120 R | 442 | 40,7 % | 0,88 | -0,065 R (-0,156 R a +0,025 R) | no |
| zona 0,5-0,786 · extensión 1,618 · con nivel clave | 994 | 40,3 % | 1,04 | +0,020 R (-0,047 R a +0,087 R) | +0,114 R / -0,080 R | 410 | 37,6 % | 0,92 | -0,046 R (-0,152 R a +0,060 R) | no |
| *zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618* (agente) | 830 | 36,4 % | 0,94 | -0,033 R (-0,113 R a +0,047 R) | +0,058 R / -0,124 R | 349 | 33,8 % | 0,86 | -0,090 R (-0,213 R a +0,033 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,020 R sobre 766 operaciones.

## 15m: las 18 configuraciones y el agente

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Acierto | Profit factor | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|---|---|
| zona 0,5-0,618 · extensión 1 · sin nivel clave | 2811 | 50,7 % | 0,66 | -0,169 R (-0,196 R a -0,141 R) | -0,167 R / -0,171 R | 8165 | 52,1 % | 0,68 | -0,158 R (-0,174 R a -0,142 R) | no |
| **zona 0,5-0,618 · extensión 1,272 · sin nivel clave** | 2479 | 42,6 % | 0,73 | -0,156 R (-0,191 R a -0,121 R) | -0,184 R / -0,120 R | 7221 | 44,8 % | 0,78 | -0,123 R (-0,143 R a -0,102 R) | no |
| zona 0,5-0,618 · extensión 1,618 · sin nivel clave | 2306 | 37,8 % | 0,74 | -0,157 R (-0,197 R a -0,116 R) | -0,201 R / -0,100 R | 6625 | 39,9 % | 0,81 | -0,116 R (-0,140 R a -0,091 R) | no |
| zona 0,618-0,786 · extensión 1 · sin nivel clave | 2801 | 41,6 % | 0,65 | -0,225 R (-0,259 R a -0,190 R) | -0,225 R / -0,224 R | 8051 | 43,5 % | 0,70 | -0,186 R (-0,207 R a -0,165 R) | no |
| zona 0,618-0,786 · extensión 1,272 · sin nivel clave | 2614 | 35,4 % | 0,68 | -0,219 R (-0,260 R a -0,178 R) | -0,236 R / -0,199 R | 7424 | 38,5 % | 0,77 | -0,151 R (-0,176 R a -0,126 R) | no |
| zona 0,618-0,786 · extensión 1,618 · sin nivel clave | 2481 | 31,7 % | 0,71 | -0,213 R (-0,260 R a -0,166 R) | -0,235 R / -0,186 R | 7005 | 35,1 % | 0,79 | -0,149 R (-0,177 R a -0,121 R) | no |
| zona 0,5-0,786 · extensión 1 · sin nivel clave | 3102 | 46,6 % | 0,65 | -0,198 R (-0,228 R a -0,169 R) | -0,193 R / -0,205 R | 8990 | 48,5 % | 0,69 | -0,170 R (-0,187 R a -0,152 R) | no |
| zona 0,5-0,786 · extensión 1,272 · sin nivel clave | 2745 | 39,3 % | 0,71 | -0,182 R (-0,219 R a -0,146 R) | -0,203 R / -0,156 R | 7947 | 41,9 % | 0,79 | -0,131 R (-0,154 R a -0,109 R) | no |
| zona 0,5-0,786 · extensión 1,618 · sin nivel clave | 2558 | 35,1 % | 0,73 | -0,178 R (-0,221 R a -0,135 R) | -0,210 R / -0,138 R | 7306 | 37,9 % | 0,81 | -0,123 R (-0,149 R a -0,096 R) | no |
| zona 0,5-0,618 · extensión 1 · con nivel clave | 416 | 51,7 % | 0,69 | -0,145 R (-0,215 R a -0,075 R) | -0,198 R / -0,065 R | 1241 | 52,3 % | 0,76 | -0,111 R (-0,152 R a -0,070 R) | no |
| zona 0,5-0,618 · extensión 1,272 · con nivel clave | 400 | 44,0 % | 0,73 | -0,146 R (-0,230 R a -0,063 R) | -0,255 R / +0,009 R | 1213 | 44,8 % | 0,83 | -0,087 R (-0,137 R a -0,038 R) | no |
| zona 0,5-0,618 · extensión 1,618 · con nivel clave | 396 | 40,2 % | 0,77 | -0,133 R (-0,228 R a -0,038 R) | -0,282 R / +0,082 R | 1195 | 40,5 % | 0,85 | -0,087 R (-0,143 R a -0,031 R) | no |
| zona 0,618-0,786 · extensión 1 · con nivel clave | 474 | 40,9 % | 0,65 | -0,216 R (-0,297 R a -0,135 R) | -0,246 R / -0,182 R | 1327 | 43,7 % | 0,75 | -0,151 R (-0,202 R a -0,101 R) | no |
| zona 0,618-0,786 · extensión 1,272 · con nivel clave | 463 | 36,1 % | 0,71 | -0,185 R (-0,279 R a -0,091 R) | -0,222 R / -0,142 R | 1305 | 39,1 % | 0,83 | -0,110 R (-0,170 R a -0,051 R) | no |
| zona 0,618-0,786 · extensión 1,618 · con nivel clave | 458 | 32,8 % | 0,74 | -0,176 R (-0,282 R a -0,071 R) | -0,206 R / -0,142 R | 1289 | 36,3 % | 0,84 | -0,104 R (-0,170 R a -0,038 R) | no |
| zona 0,5-0,786 · extensión 1 · con nivel clave | 757 | 46,4 % | 0,66 | -0,183 R (-0,241 R a -0,125 R) | -0,192 R / -0,171 R | 2219 | 48,6 % | 0,76 | -0,125 R (-0,161 R a -0,090 R) | no |
| zona 0,5-0,786 · extensión 1,272 · con nivel clave | 718 | 39,7 % | 0,72 | -0,166 R (-0,236 R a -0,097 R) | -0,228 R / -0,088 R | 2134 | 42,4 % | 0,83 | -0,095 R (-0,137 R a -0,053 R) | no |
| zona 0,5-0,786 · extensión 1,618 · con nivel clave | 707 | 36,1 % | 0,75 | -0,152 R (-0,232 R a -0,072 R) | -0,241 R / -0,038 R | 2074 | 39,1 % | 0,86 | -0,082 R (-0,129 R a -0,035 R) | no |
| *zona 0,618-0,786 · extensión 1,618 · con nivel clave · objetivos 1, 1,272 y 1,618* (agente) | 458 | 32,8 % | 0,74 | -0,176 R (-0,282 R a -0,071 R) | -0,206 R / -0,142 R | 1289 | 36,3 % | 0,84 | -0,104 R (-0,170 R a -0,038 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,294 R sobre 11260 operaciones.
