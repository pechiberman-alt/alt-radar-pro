# Búsqueda de confirmación y configuración: breaker block

Generado el 2026-10-14 con `scripts/investigacion/breaker-busqueda.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min, del 2020-01-01 al 2026-09-30. Desarrollo hasta el 2024-09-21, evaluación después: el mismo corte que el estudio (`docs/estudio-estrategias.md`). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Qué se buscó

Un breaker block es un order block (la última vela contraria antes de un impulso que rompió el máximo o mínimo de las 20 velas previas, con un desplazamiento mínimo) que el precio después cierra por el otro lado: la zona cambia de papel, lo que era demanda pasa a oferta y al revés. Se opera el retesteo de la zona invertida (hasta 30 velas después de la rotura), con el stop a un margen más allá del borde lejano de la zona. Si una vela cierra del otro lado de la zona por completo antes del retesteo, el breaker falló. Una zona que obliga a un stop a más de 4 ATR del cierre no se opera. La entrada es la apertura de la vela siguiente al retesteo.

- **Fase 1, confirmaciones** (con la configuración base: desplazamiento 1,8 ATR, margen 0,5 ATR, objetivo 2 R):
  - **TOQUE**: Opera la primera vela que vuelve a tocar la zona, sin pedir nada más (cierra donde cierre, mientras no la haya pasado por completo).
  - **RECHAZO**: La vela toca la zona y cierra del lado del breaker, fuera de ella (debajo para cortos, encima para largos).
  - **MECHA**: Rechazo, y además la mecha que entra a la zona es la mitad o más del rango de la vela.
  - **RUPTURA_FUERTE**: Rechazo, y la vela que rompió el order block tuvo un rango de 1,5 ATR o más.
  - **VOLUMEN**: Rechazo, y la vela que rompió el order block tuvo 1,5 veces o más el volumen promedio de las 20 anteriores.
  - **EMA200**: Rechazo, y el cierre queda del lado del breaker respecto de la EMA 200 de su propia temporalidad.
  - **HTF**: Rechazo, y el Supertrend del marco superior (4 h para 1 h y 15 min; diario para 4 h) va en el sentido del breaker.
- **Fase 2, configuraciones** (con la confirmación elegida en la fase 1): desplazamiento mínimo de 1,5, 1,8 o 2,5 ATR × margen del stop de 0,25, 0,5 o 1 ATR × objetivo de 1,5, 2 o 3 R. Son 27; la base ya está en la fase 1.
- **Elección**: solo con el DESARROLLO. Candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una). Entre las candidatas, gana la de piso más alto del intervalo del 90 % de la expectancia. Si ninguna es candidata, se muestra la de piso más alto, marcada como no estable.
- **Contabilidad**: 33 variantes distintas por temporalidad, 99 en total. El DSR de esta búsqueda cuenta esas 99; el declarado del estudio pasa a 400 (300 de antes, más estas 99, redondeado para arriba).

## Cómo leerlo

- Todo lo de desarrollo se eligió sin mirar la evaluación. Pero **el período de evaluación ya se miró** con otras estrategias (el estudio y la búsqueda de la línea de tendencia usan el mismo corte y las mismas monedas), y el declarado de ensayos lo cuenta. Esta es la primera vez que se mide el breaker block, pero los números de evaluación no son una prueba limpia.
- La búsqueda es **escalonada**: la confirmación se elige con la base y después se busca la configuración. Una búsqueda conjunta (7 × 27 por temporalidad) podría dar otra combinación, y contaría más variantes.
- Los umbrales (impulso de 4 velas, 20 velas de estructura, 50 de rotura, 30 de retesteo, mecha de la mitad del rango, rotura de 1,5 ATR, volumen de 1,5 veces, riesgo máximo de 4 ATR) son fijos: no se afinaron. Cambiarlos sería otra variante, y entraría en la cuenta.
- La detección es propia de esta medición y causal: no usa la de `lib/order-blocks.ts`, que sirve para dibujar y mira velas posteriores. La zona es el rango completo de la vela de origen, como allí.
- Los intervalos son del 90 %: media ± 1,645 errores estándar de la expectancia. Un intervalo que cruza cero no da conclusión.
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero. La única prueba limpia es la medición hacia adelante en papel, que todavía no existe para esta variante.

## Resumen por temporalidad

- **1h**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es **EMA200** con desplazamiento 1,5 ATR · margen 1 ATR · objetivo 3 R, y queda marcada como no estable. En evaluación: 2050 operaciones, expectancia -0,033 R (IC -0,087 R a +0,021 R), veredicto SIN CONCLUSIÓN.
- **4h**: **VOLUMEN** con desplazamiento 1,8 ATR · margen 1 ATR · objetivo 3 R. En desarrollo, 935 operaciones con expectancia +0,110 R (IC +0,028 R a +0,191 R). En evaluación: 403 operaciones, expectancia +0,064 R (IC -0,061 R a +0,190 R), acierto 36,7 %, profit factor 1,11. DSR con N = 99: 0,2 %. Veredicto: SIN CONCLUSIÓN.
- **15m**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es **RECHAZO** con desplazamiento 1,5 ATR · margen 1 ATR · objetivo 1,5 R, y queda marcada como no estable. En evaluación: 14274 operaciones, expectancia -0,159 R (IC -0,175 R a -0,143 R), veredicto SIN VENTAJA.
- **Para transparencia**: entre las 99 variantes, la de mejor expectancia en evaluación es **VOLUMEN** con desplazamiento 2,5 ATR · margen 1 ATR · objetivo 3 R en 4h (288 operaciones, expectancia +0,122 R, IC -0,028 R a +0,272 R). No es la que eligió la regla de desarrollo, y como la evaluación ya se miró, se muestra como dato y no como resultado. Con las 99 variantes, el Reality Check da p = 0,98 y el SPA p = 0,74: no alcanza para distinguirla de la suerte (el SPA es el más confiable cuando las variantes tienen varianzas distintas).

## Auditoría de sobreajuste

Variantes de la búsqueda: 99. Ensayos declarados del estudio: 400. Varianza de los Sharpe por operación entre las 99 variantes en evaluación: 0,0051. Días de evaluación: 740.

| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |
|---|---|---|---|---|---|
| 1h | EMA200 · desplazamiento 1,5 ATR · margen 1 ATR · objetivo 3 R | 16,2 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| 4h | VOLUMEN · desplazamiento 1,8 ATR · margen 1 ATR · objetivo 3 R | 80,6 % | 0,2 % | 0,0 % | SIN CONCLUSIÓN |
| 15m | RECHAZO · desplazamiento 1,5 ATR · margen 1 ATR · objetivo 1,5 R | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |

Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las 99 variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = 0,98 (Reality Check) y p = 0,74 (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí. Como la evaluación ya se miró, esto corrige por la búsqueda pero no por esa mirada previa.

Un DSR menor a 95 % no alcanza para decir que hay ventaja. Una VENTAJA con DSR declarado menor a 95 % baja a CANDIDATA.

## 1h: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| TOQUE | 9708 | 35,3 % | 0,85 | -0,104 R (-0,127 R a -0,081 R) | -0,049 R / -0,155 R | 4244 | -0,132 R (-0,166 R a -0,097 R) | no |
| RECHAZO | 7835 | 35,7 % | 0,86 | -0,096 R (-0,121 R a -0,072 R) | -0,040 R / -0,149 R | 3433 | -0,082 R (-0,119 R a -0,044 R) | no |
| MECHA | 4845 | 35,5 % | 0,85 | -0,101 R (-0,132 R a -0,070 R) | -0,061 R / -0,138 R | 2142 | -0,084 R (-0,132 R a -0,035 R) | no |
| RUPTURA_FUERTE | 4192 | 34,9 % | 0,82 | -0,119 R (-0,152 R a -0,086 R) | -0,081 R / -0,153 R | 1688 | -0,096 R (-0,150 R a -0,042 R) | no |
| VOLUMEN | 4412 | 35,2 % | 0,85 | -0,100 R (-0,133 R a -0,067 R) | -0,042 R / -0,152 R | 1807 | -0,092 R (-0,144 R a -0,040 R) | no |
| **EMA200** | 4616 | 36,3 % | 0,88 | -0,078 R (-0,111 R a -0,046 R) | +0,001 R / -0,149 R | 2068 | -0,041 R (-0,091 R a +0,008 R) | no |
| HTF | 3879 | 35,4 % | 0,87 | -0,087 R (-0,123 R a -0,052 R) | -0,006 R / -0,160 R | 1702 | -0,105 R (-0,160 R a -0,051 R) | no |

## 1h: fase 2, configuraciones (con EMA200)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 5654 | 41,0 % | 0,86 | -0,092 R (-0,118 R a -0,065 R) | -0,038 R / -0,140 R | 2521 | -0,108 R (-0,148 R a -0,069 R) | no |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 2 R | 5457 | 35,5 % | 0,86 | -0,094 R (-0,124 R a -0,064 R) | -0,031 R / -0,151 R | 2439 | -0,057 R (-0,103 R a -0,011 R) | no |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 3 R | 5267 | 30,5 % | 0,90 | -0,071 R (-0,107 R a -0,034 R) | +0,008 R / -0,143 R | 2336 | -0,023 R (-0,079 R a +0,034 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 5346 | 41,5 % | 0,88 | -0,072 R (-0,099 R a -0,045 R) | -0,024 R / -0,116 R | 2404 | -0,078 R (-0,118 R a -0,038 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 2 R | 5158 | 36,7 % | 0,91 | -0,061 R (-0,092 R a -0,030 R) | +0,006 R / -0,122 R | 2312 | -0,039 R (-0,086 R a +0,007 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 3 R | 4998 | 32,3 % | 0,93 | -0,047 R (-0,083 R a -0,010 R) | +0,031 R / -0,118 R | 2238 | -0,021 R (-0,077 R a +0,036 R) | no |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 1,5 R | 4824 | 42,5 % | 0,93 | -0,042 R (-0,069 R a -0,015 R) | +0,015 R / -0,094 R | 2178 | -0,049 R (-0,090 R a -0,008 R) | no |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 2 R | 4689 | 38,9 % | 0,95 | -0,028 R (-0,059 R a +0,003 R) | +0,043 R / -0,092 R | 2101 | -0,039 R (-0,086 R a +0,008 R) | no |
| **desplazamiento 1,5 ATR · margen 1 ATR · objetivo 3 R** | 4581 | 35,9 % | 0,99 | -0,008 R (-0,044 R a +0,027 R) | +0,072 R / -0,083 R | 2050 | -0,033 R (-0,087 R a +0,021 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 1,5 R | 5008 | 40,5 % | 0,83 | -0,107 R (-0,134 R a -0,079 R) | -0,040 R / -0,167 R | 2216 | -0,100 R (-0,142 R a -0,058 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 2 R | 4854 | 35,0 % | 0,84 | -0,112 R (-0,144 R a -0,081 R) | -0,038 R / -0,179 R | 2164 | -0,041 R (-0,090 R a +0,008 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 3 R | 4719 | 30,1 % | 0,88 | -0,088 R (-0,127 R a -0,050 R) | -0,011 R / -0,158 R | 2085 | -0,018 R (-0,078 R a +0,042 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 1,5 R | 4762 | 40,8 % | 0,85 | -0,092 R (-0,120 R a -0,064 R) | -0,035 R / -0,142 R | 2138 | -0,073 R (-0,115 R a -0,030 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 2 R | 4616 | 36,3 % | 0,88 | -0,078 R (-0,111 R a -0,046 R) | +0,001 R / -0,149 R | 2068 | -0,041 R (-0,091 R a +0,008 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 3 R | 4504 | 32,0 % | 0,91 | -0,061 R (-0,099 R a -0,022 R) | +0,018 R / -0,131 R | 2010 | -0,024 R (-0,083 R a +0,035 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 1,5 R | 4342 | 42,5 % | 0,92 | -0,046 R (-0,074 R a -0,017 R) | +0,021 R / -0,105 R | 1954 | -0,049 R (-0,092 R a -0,006 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 2 R | 4240 | 39,1 % | 0,96 | -0,025 R (-0,058 R a +0,007 R) | +0,046 R / -0,090 R | 1895 | -0,044 R (-0,093 R a +0,005 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 3 R | 4159 | 36,0 % | 0,99 | -0,008 R (-0,046 R a +0,030 R) | +0,063 R / -0,073 R | 1855 | -0,023 R (-0,080 R a +0,034 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 3366 | 40,4 % | 0,83 | -0,112 R (-0,146 R a -0,078 R) | -0,049 R / -0,170 R | 1474 | -0,075 R (-0,126 R a -0,023 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 2 R | 3297 | 34,9 % | 0,82 | -0,124 R (-0,162 R a -0,085 R) | -0,054 R / -0,187 R | 1438 | -0,049 R (-0,109 R a +0,011 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 3 R | 3235 | 30,4 % | 0,86 | -0,102 R (-0,148 R a -0,057 R) | -0,036 R / -0,163 R | 1410 | +0,004 R (-0,069 R a +0,077 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 3239 | 40,8 % | 0,85 | -0,095 R (-0,129 R a -0,061 R) | -0,041 R / -0,144 R | 1430 | -0,048 R (-0,100 R a +0,004 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 2 R | 3180 | 36,5 % | 0,87 | -0,084 R (-0,123 R a -0,046 R) | -0,010 R / -0,152 R | 1392 | -0,033 R (-0,093 R a +0,027 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 3 R | 3123 | 32,3 % | 0,90 | -0,071 R (-0,116 R a -0,025 R) | +0,003 R / -0,138 R | 1359 | -0,005 R (-0,077 R a +0,066 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 1,5 R | 3022 | 42,9 % | 0,93 | -0,040 R (-0,074 R a -0,006 R) | +0,010 R / -0,086 R | 1315 | -0,053 R (-0,106 R a -0,001 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 2 R | 2971 | 39,8 % | 0,97 | -0,017 R (-0,056 R a +0,021 R) | +0,038 R / -0,068 R | 1290 | -0,023 R (-0,083 R a +0,037 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 3 R | 2929 | 36,7 % | 0,99 | -0,006 R (-0,050 R a +0,039 R) | +0,056 R / -0,062 R | 1270 | -0,000 R (-0,069 R a +0,069 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,010 R sobre 2895 operaciones.

## 4h: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| TOQUE | 2399 | 37,4 % | 1,00 | +0,001 R (-0,046 R a +0,047 R) | +0,049 R / -0,043 R | 1081 | -0,007 R (-0,076 R a +0,063 R) | no |
| RECHAZO | 1949 | 38,2 % | 1,01 | +0,005 R (-0,045 R a +0,055 R) | +0,021 R / -0,009 R | 883 | -0,005 R (-0,080 R a +0,071 R) | no |
| MECHA | 1232 | 37,3 % | 0,99 | -0,004 R (-0,068 R a +0,059 R) | +0,005 R / -0,013 R | 541 | -0,085 R (-0,181 R a +0,011 R) | no |
| RUPTURA_FUERTE | 1055 | 37,4 % | 0,99 | -0,007 R (-0,075 R a +0,061 R) | -0,009 R / -0,006 R | 416 | +0,015 R (-0,095 R a +0,125 R) | no |
| **VOLUMEN** | 1046 | 38,6 % | 1,05 | +0,032 R (-0,037 R a +0,102 R) | +0,057 R / +0,011 R | 452 | -0,014 R (-0,119 R a +0,092 R) | sí |
| EMA200 | 1155 | 40,7 % | 1,12 | +0,074 R (+0,008 R a +0,140 R) | +0,164 R / -0,001 R | 519 | +0,052 R (-0,048 R a +0,151 R) | no |
| HTF | 975 | 41,5 % | 1,17 | +0,099 R (+0,026 R a +0,172 R) | +0,241 R / -0,023 R | 458 | -0,009 R (-0,115 R a +0,097 R) | no |

## 4h: fase 2, configuraciones (con VOLUMEN)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 1238 | 43,3 % | 1,03 | +0,017 R (-0,040 R a +0,074 R) | +0,039 R / -0,001 R | 547 | -0,026 R (-0,112 R a +0,059 R) | no |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 2 R | 1203 | 38,6 % | 1,09 | +0,054 R (-0,013 R a +0,120 R) | +0,105 R / +0,011 R | 528 | -0,003 R (-0,103 R a +0,096 R) | sí |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 3 R | 1150 | 32,7 % | 1,10 | +0,068 R (-0,013 R a +0,149 R) | +0,122 R / +0,023 R | 512 | +0,022 R (-0,100 R a +0,144 R) | sí |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 1185 | 43,5 % | 1,03 | +0,017 R (-0,040 R a +0,075 R) | +0,047 R / -0,008 R | 518 | -0,017 R (-0,104 R a +0,070 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 2 R | 1152 | 39,0 % | 1,07 | +0,041 R (-0,026 R a +0,107 R) | +0,069 R / +0,017 R | 505 | -0,016 R (-0,115 R a +0,084 R) | sí |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 3 R | 1109 | 34,4 % | 1,12 | +0,077 R (-0,003 R a +0,157 R) | +0,114 R / +0,046 R | 485 | +0,047 R (-0,075 R a +0,170 R) | sí |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 1,5 R | 1093 | 45,2 % | 1,09 | +0,049 R (-0,009 R a +0,107 R) | +0,095 R / +0,010 R | 476 | -0,028 R (-0,116 R a +0,060 R) | sí |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 2 R | 1057 | 40,4 % | 1,07 | +0,040 R (-0,026 R a +0,106 R) | +0,089 R / -0,002 R | 459 | +0,001 R (-0,100 R a +0,102 R) | no |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 3 R | 1024 | 38,5 % | 1,17 | +0,103 R (+0,025 R a +0,181 R) | +0,160 R / +0,054 R | 444 | +0,059 R (-0,061 R a +0,179 R) | sí |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 1,5 R | 1114 | 43,4 % | 1,04 | +0,022 R (-0,038 R a +0,082 R) | +0,052 R / -0,003 R | 484 | -0,018 R (-0,109 R a +0,073 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 2 R | 1083 | 38,3 % | 1,08 | +0,049 R (-0,021 R a +0,119 R) | +0,107 R / +0,001 R | 471 | -0,008 R (-0,114 R a +0,097 R) | sí |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 3 R | 1045 | 33,0 % | 1,12 | +0,083 R (-0,002 R a +0,169 R) | +0,132 R / +0,042 R | 458 | -0,004 R (-0,132 R a +0,124 R) | sí |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 1,5 R | 1071 | 43,2 % | 1,02 | +0,013 R (-0,047 R a +0,074 R) | +0,044 R / -0,012 R | 463 | +0,002 R (-0,090 R a +0,094 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 2 R | 1046 | 38,6 % | 1,05 | +0,032 R (-0,037 R a +0,102 R) | +0,057 R / +0,011 R | 452 | -0,014 R (-0,119 R a +0,092 R) | sí |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 3 R | 1011 | 34,3 % | 1,11 | +0,075 R (-0,009 R a +0,159 R) | +0,114 R / +0,042 R | 439 | +0,033 R (-0,095 R a +0,161 R) | sí |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 1,5 R | 996 | 45,9 % | 1,13 | +0,068 R (+0,007 R a +0,129 R) | +0,124 R / +0,021 R | 427 | +0,007 R (-0,086 R a +0,100 R) | sí |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 2 R | 964 | 40,9 % | 1,10 | +0,055 R (-0,014 R a +0,124 R) | +0,117 R / +0,002 R | 414 | +0,034 R (-0,073 R a +0,140 R) | sí |
| **desplazamiento 1,8 ATR · margen 1 ATR · objetivo 3 R** | 935 | 38,9 % | 1,19 | +0,110 R (+0,028 R a +0,191 R) | +0,175 R / +0,054 R | 403 | +0,064 R (-0,061 R a +0,190 R) | sí |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 782 | 44,2 % | 1,08 | +0,043 R (-0,028 R a +0,115 R) | +0,058 R / +0,032 R | 322 | -0,031 R (-0,143 R a +0,080 R) | sí |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 2 R | 772 | 39,1 % | 1,12 | +0,075 R (-0,009 R a +0,158 R) | +0,099 R / +0,055 R | 315 | -0,016 R (-0,144 R a +0,112 R) | sí |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 3 R | 754 | 33,8 % | 1,15 | +0,103 R (+0,002 R a +0,204 R) | +0,129 R / +0,081 R | 310 | +0,020 R (-0,136 R a +0,176 R) | sí |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 764 | 43,7 % | 1,03 | +0,020 R (-0,052 R a +0,091 R) | -0,006 R / +0,041 R | 311 | +0,011 R (-0,101 R a +0,123 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 2 R | 755 | 39,9 % | 1,11 | +0,067 R (-0,015 R a +0,149 R) | +0,027 R / +0,100 R | 305 | -0,002 R (-0,130 R a +0,126 R) | sí |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 3 R | 735 | 35,8 % | 1,18 | +0,115 R (+0,016 R a +0,214 R) | +0,117 R / +0,113 R | 301 | +0,067 R (-0,088 R a +0,222 R) | sí |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 1,5 R | 724 | 45,9 % | 1,14 | +0,075 R (+0,004 R a +0,147 R) | +0,068 R / +0,081 R | 297 | +0,023 R (-0,088 R a +0,134 R) | sí |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 2 R | 705 | 41,8 % | 1,14 | +0,080 R (-0,001 R a +0,161 R) | +0,093 R / +0,069 R | 292 | +0,049 R (-0,078 R a +0,176 R) | sí |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 3 R | 692 | 39,5 % | 1,19 | +0,113 R (+0,018 R a +0,207 R) | +0,125 R / +0,102 R | 288 | +0,122 R (-0,028 R a +0,272 R) | sí |

Control (entradas al azar, mismas fechas de evaluación): -0,020 R sobre 766 operaciones.

## 15m: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| TOQUE | 6073 | 35,4 % | 0,69 | -0,248 R (-0,277 R a -0,219 R) | -0,245 R / -0,250 R | 17244 | -0,272 R (-0,290 R a -0,255 R) | no |
| **RECHAZO** | 4885 | 35,5 % | 0,73 | -0,203 R (-0,234 R a -0,171 R) | -0,197 R / -0,209 R | 13848 | -0,214 R (-0,232 R a -0,195 R) | no |
| MECHA | 3088 | 34,7 % | 0,70 | -0,229 R (-0,268 R a -0,190 R) | -0,206 R / -0,253 R | 8340 | -0,198 R (-0,223 R a -0,174 R) | no |
| RUPTURA_FUERTE | 2283 | 34,7 % | 0,71 | -0,216 R (-0,262 R a -0,170 R) | -0,226 R / -0,206 R | 6698 | -0,215 R (-0,242 R a -0,188 R) | no |
| VOLUMEN | 2481 | 34,9 % | 0,72 | -0,210 R (-0,254 R a -0,166 R) | -0,185 R / -0,235 R | 7259 | -0,197 R (-0,224 R a -0,171 R) | no |
| EMA200 | 2964 | 35,8 % | 0,74 | -0,195 R (-0,235 R a -0,155 R) | -0,175 R / -0,215 R | 8224 | -0,210 R (-0,234 R a -0,185 R) | no |
| HTF | 2695 | 35,0 % | 0,72 | -0,211 R (-0,254 R a -0,169 R) | -0,214 R / -0,209 R | 7577 | -0,221 R (-0,246 R a -0,195 R) | no |

## 15m: fase 2, configuraciones (con RECHAZO)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 6307 | 40,9 % | 0,68 | -0,229 R (-0,254 R a -0,203 R) | -0,221 R / -0,236 R | 17765 | -0,249 R (-0,264 R a -0,234 R) | no |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 2 R | 5888 | 34,9 % | 0,70 | -0,237 R (-0,266 R a -0,207 R) | -0,239 R / -0,234 R | 16610 | -0,241 R (-0,259 R a -0,223 R) | no |
| desplazamiento 1,5 ATR · margen 0,25 ATR · objetivo 3 R | 5412 | 29,8 % | 0,73 | -0,230 R (-0,266 R a -0,195 R) | -0,222 R / -0,239 R | 15387 | -0,228 R (-0,250 R a -0,207 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 5822 | 40,8 % | 0,71 | -0,199 R (-0,225 R a -0,173 R) | -0,188 R / -0,210 R | 16489 | -0,206 R (-0,222 R a -0,191 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 2 R | 5401 | 36,0 % | 0,74 | -0,190 R (-0,220 R a -0,160 R) | -0,193 R / -0,188 R | 15335 | -0,205 R (-0,223 R a -0,187 R) | no |
| desplazamiento 1,5 ATR · margen 0,5 ATR · objetivo 3 R | 5012 | 31,8 % | 0,76 | -0,188 R (-0,223 R a -0,152 R) | -0,195 R / -0,180 R | 14294 | -0,196 R (-0,217 R a -0,174 R) | no |
| **desplazamiento 1,5 ATR · margen 1 ATR · objetivo 1,5 R** | 5005 | 41,8 % | 0,77 | -0,143 R (-0,170 R a -0,117 R) | -0,167 R / -0,119 R | 14274 | -0,159 R (-0,175 R a -0,143 R) | no |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 2 R | 4710 | 37,9 % | 0,78 | -0,148 R (-0,178 R a -0,118 R) | -0,166 R / -0,129 R | 13391 | -0,156 R (-0,174 R a -0,138 R) | no |
| desplazamiento 1,5 ATR · margen 1 ATR · objetivo 3 R | 4479 | 35,3 % | 0,79 | -0,142 R (-0,177 R a -0,107 R) | -0,150 R / -0,134 R | 12679 | -0,151 R (-0,173 R a -0,130 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 1,5 R | 5621 | 40,4 % | 0,67 | -0,237 R (-0,263 R a -0,210 R) | -0,219 R / -0,254 R | 15771 | -0,252 R (-0,268 R a -0,236 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 2 R | 5297 | 34,5 % | 0,69 | -0,245 R (-0,276 R a -0,215 R) | -0,238 R / -0,253 R | 14857 | -0,245 R (-0,263 R a -0,226 R) | no |
| desplazamiento 1,8 ATR · margen 0,25 ATR · objetivo 3 R | 4905 | 29,2 % | 0,71 | -0,249 R (-0,287 R a -0,212 R) | -0,233 R / -0,266 R | 13874 | -0,239 R (-0,262 R a -0,217 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 1,5 R | 5241 | 40,4 % | 0,70 | -0,204 R (-0,231 R a -0,177 R) | -0,186 R / -0,222 R | 14769 | -0,207 R (-0,223 R a -0,191 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 2 R | 4885 | 35,5 % | 0,73 | -0,203 R (-0,234 R a -0,171 R) | -0,197 R / -0,209 R | 13848 | -0,214 R (-0,232 R a -0,195 R) | no |
| desplazamiento 1,8 ATR · margen 0,5 ATR · objetivo 3 R | 4586 | 31,0 % | 0,74 | -0,204 R (-0,241 R a -0,167 R) | -0,209 R / -0,198 R | 12990 | -0,210 R (-0,232 R a -0,187 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 1,5 R | 4567 | 41,3 % | 0,75 | -0,155 R (-0,182 R a -0,127 R) | -0,166 R / -0,144 R | 12953 | -0,171 R (-0,187 R a -0,154 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 2 R | 4321 | 37,3 % | 0,76 | -0,158 R (-0,189 R a -0,127 R) | -0,168 R / -0,148 R | 12203 | -0,172 R (-0,191 R a -0,153 R) | no |
| desplazamiento 1,8 ATR · margen 1 ATR · objetivo 3 R | 4134 | 34,4 % | 0,77 | -0,157 R (-0,193 R a -0,121 R) | -0,161 R / -0,152 R | 11648 | -0,160 R (-0,182 R a -0,138 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 1,5 R | 3731 | 40,6 % | 0,68 | -0,227 R (-0,259 R a -0,194 R) | -0,213 R / -0,241 R | 10442 | -0,236 R (-0,255 R a -0,216 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 2 R | 3602 | 35,2 % | 0,72 | -0,221 R (-0,258 R a -0,183 R) | -0,223 R / -0,219 R | 10052 | -0,227 R (-0,249 R a -0,204 R) | no |
| desplazamiento 2,5 ATR · margen 0,25 ATR · objetivo 3 R | 3424 | 29,2 % | 0,71 | -0,249 R (-0,293 R a -0,205 R) | -0,238 R / -0,260 R | 9619 | -0,220 R (-0,247 R a -0,193 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 1,5 R | 3576 | 40,2 % | 0,70 | -0,208 R (-0,240 R a -0,175 R) | -0,202 R / -0,213 R | 9975 | -0,188 R (-0,208 R a -0,169 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 2 R | 3426 | 35,5 % | 0,73 | -0,202 R (-0,239 R a -0,165 R) | -0,204 R / -0,200 R | 9577 | -0,192 R (-0,214 R a -0,169 R) | no |
| desplazamiento 2,5 ATR · margen 0,5 ATR · objetivo 3 R | 3271 | 30,9 % | 0,73 | -0,216 R (-0,260 R a -0,172 R) | -0,222 R / -0,210 R | 9192 | -0,200 R (-0,227 R a -0,174 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 1,5 R | 3264 | 41,6 % | 0,76 | -0,151 R (-0,184 R a -0,118 R) | -0,175 R / -0,128 R | 9155 | -0,158 R (-0,177 R a -0,138 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 2 R | 3132 | 37,4 % | 0,75 | -0,166 R (-0,203 R a -0,130 R) | -0,175 R / -0,158 R | 8805 | -0,163 R (-0,186 R a -0,141 R) | no |
| desplazamiento 2,5 ATR · margen 1 ATR · objetivo 3 R | 3024 | 34,8 % | 0,76 | -0,163 R (-0,205 R a -0,122 R) | -0,183 R / -0,143 R | 8495 | -0,160 R (-0,186 R a -0,135 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,294 R sobre 11260 operaciones.
