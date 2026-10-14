# Búsqueda de confirmación y configuración: línea de tendencia

Generado el 2026-10-14 con `scripts/investigacion/linea-busqueda.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min, del 2020-01-01 al 2026-09-30. Desarrollo hasta el 2024-09-21, evaluación después: el mismo corte que el estudio (`docs/estudio-estrategias.md`). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Qué se buscó

Una ruptura de línea de tendencia (TENDENCIA_LINEA: dos pivotes, una línea que el precio respeta entre ambos y un cierre que la pasa por 0,1 ATR) tiene dos decisiones: qué confirmación exige y qué configuración usa.

- **Fase 1, confirmaciones** (con la configuración base: pivotes de 5 velas, stop a 1,5 ATR, objetivo a 2 R):
  - **NINGUNA**: Opera la ruptura en el cierre que la confirma, sin filtro (la regla de TENDENCIA_LINEA).
  - **VOLUMEN**: Solo si el volumen de la vela de ruptura es 1,5 veces o más el promedio de las 20 velas anteriores.
  - **CIERRE_FUERTE**: Solo si la vela de ruptura cierra en el 30 % superior de su rango (alcista) o inferior (bajista).
  - **EMA200**: Solo si el cierre queda del lado de la ruptura respecto de la EMA 200 de su propia temporalidad.
  - **HTF**: Solo si el Supertrend del marco superior va en el sentido de la ruptura (4 h para 1 h y 15 min; diario para 4 h).
  - **CIERRE_SIGUIENTE**: Entra si la vela siguiente a la ruptura también cierra del lado de la ruptura; la entrada es la apertura de la vela después.
  - **REENTRADA**: Espera el retesteo: hasta 30 velas después, una mecha vuelve a la línea (a 0,3 ATR) y cierra del lado de la ruptura. Si antes cierra 0,1 ATR del otro lado, la línea falló.
- **Fase 2, configuraciones** (con la confirmación elegida en la fase 1): pivotes de 3, 5 u 8 velas × stop de 1, 1,5 o 2 ATR × objetivo de 1,5, 2 o 3 R. Son 27; la base ya está en la fase 1.
- **Elección**: solo con el DESARROLLO. Candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una). Entre las candidatas, gana la de piso más alto del intervalo del 90 % de la expectancia. Si ninguna es candidata, se muestra la de piso más alto, marcada como no estable.
- **Contabilidad**: 33 variantes distintas por temporalidad, 99 en total. El DSR de esta búsqueda cuenta esas 99; el declarado del estudio pasa a 300 (200 de antes, más estas 99, redondeado para arriba).

## Cómo leerlo

- Todo lo de desarrollo se eligió sin mirar la evaluación. Pero **la evaluación ya se había mirado**: el estudio anterior midió TENDENCIA_LINEA (la configuración base, sin confirmación) en 1 h, 4 h y 15 min. Los números de evaluación de esta búsqueda no son una prueba limpia.
- La búsqueda es **escalonada**: la confirmación se elige con la base y después se busca la configuración. Una búsqueda conjunta (7 × 27 por temporalidad) podría dar otra combinación, y contaría más variantes.
- Los umbrales (volumen de 1,5 veces, cierre en el 30 % del rango, 30 velas de retesteo, 0,3 ATR) son fijos: no se afinaron. Cambiarlos sería otra variante, y entraría en la cuenta.
- Los intervalos son del 90 %: media ± 1,645 errores estándar de la expectancia. Un intervalo que cruza cero no da conclusión.
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero. La única prueba limpia es la medición hacia adelante en papel, que todavía no existe para esta variante.

## Resumen por temporalidad

- **1h**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es **EMA200** con pivotes 8 · stop 2 ATR · objetivo 3 R, y queda marcada como no estable. En evaluación: 1349 operaciones, expectancia -0,100 R (IC -0,170 R a -0,029 R), veredicto SIN VENTAJA.
- **4h**: **VOLUMEN** con pivotes 5 · stop 1,5 ATR · objetivo 3 R. En desarrollo, 654 operaciones con expectancia +0,250 R (IC +0,136 R a +0,364 R). En evaluación: 336 operaciones, expectancia -0,013 R (IC -0,165 R a +0,138 R), acierto 29,2 %, profit factor 0,98. DSR con N = 99: 0,0 %. Veredicto: SIN CONCLUSIÓN.
- **15m**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es **VOLUMEN** con pivotes 3 · stop 2 ATR · objetivo 3 R, y queda marcada como no estable. En evaluación: 4514 operaciones, expectancia -0,104 R (IC -0,144 R a -0,064 R), veredicto SIN VENTAJA.
- **Para transparencia**: entre las 99 variantes, la de mejor expectancia en evaluación es **EMA200** con pivotes 5 · stop 1,5 ATR · objetivo 2 R en 4h (565 operaciones, expectancia +0,208 R, IC +0,106 R a +0,309 R). No es la que eligió la regla de desarrollo, y como la evaluación ya se miró, se muestra como dato y no como resultado. Con las 99 variantes, el Reality Check da p = 0,84 y el SPA p = 0,12: no alcanza para distinguirla de la suerte (el SPA es el más confiable cuando las variantes tienen varianzas distintas).

## Auditoría de sobreajuste

Variantes de la búsqueda: 99. Ensayos declarados del estudio: 300. Varianza de los Sharpe por operación entre las 99 variantes en evaluación: 0,0068. Días de evaluación: 740.

| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |
|---|---|---|---|---|---|
| 1h | EMA200 · pivotes 8 · stop 2 ATR · objetivo 3 R | 1,2 % | 0,0 % | 0,0 % | SIN VENTAJA |
| 4h | VOLUMEN · pivotes 5 · stop 1,5 ATR · objetivo 3 R | 44,3 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| 15m | VOLUMEN · pivotes 3 · stop 2 ATR · objetivo 3 R | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |

Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las 99 variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = 0,84 (Reality Check) y p = 0,12 (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí. Como la evaluación ya se miró, esto corrige por la búsqueda pero no por esa mirada previa.

Un DSR menor a 95 % no alcanza para decir que hay ventaja. Una VENTAJA con DSR declarado menor a 95 % baja a CANDIDATA.

## 1h: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| NINGUNA | 8485 | 36,0 % | 0,92 | -0,053 R (-0,078 R a -0,028 R) | -0,021 R / -0,084 R | 3474 | -0,085 R (-0,124 R a -0,046 R) | no |
| VOLUMEN | 2941 | 36,6 % | 0,96 | -0,029 R (-0,072 R a +0,013 R) | +0,002 R / -0,059 R | 1168 | -0,095 R (-0,162 R a -0,028 R) | no |
| CIERRE_FUERTE | 6387 | 36,0 % | 0,93 | -0,050 R (-0,079 R a -0,021 R) | -0,012 R / -0,087 R | 2628 | -0,119 R (-0,164 R a -0,075 R) | no |
| **EMA200** | 5155 | 36,7 % | 0,95 | -0,031 R (-0,063 R a +0,001 R) | +0,016 R / -0,076 R | 2016 | -0,111 R (-0,163 R a -0,060 R) | no |
| HTF | 4971 | 36,6 % | 0,95 | -0,038 R (-0,071 R a -0,005 R) | +0,019 R / -0,094 R | 1933 | -0,101 R (-0,154 R a -0,049 R) | no |
| CIERRE_SIGUIENTE | 7729 | 35,8 % | 0,92 | -0,056 R (-0,082 R a -0,030 R) | -0,025 R / -0,087 R | 3167 | -0,082 R (-0,123 R a -0,041 R) | no |
| REENTRADA | 5966 | 34,6 % | 0,88 | -0,088 R (-0,118 R a -0,058 R) | -0,064 R / -0,111 R | 2347 | -0,096 R (-0,143 R a -0,048 R) | no |

## 1h: fase 2, configuraciones (con EMA200)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| pivotes 3 · stop 1 ATR · objetivo 1,5 R | 7739 | 41,3 % | 0,82 | -0,119 R (-0,142 R a -0,096 R) | -0,077 R / -0,159 R | 3080 | -0,182 R (-0,219 R a -0,146 R) | no |
| pivotes 3 · stop 1 ATR · objetivo 2 R | 7624 | 35,0 % | 0,86 | -0,105 R (-0,132 R a -0,078 R) | -0,050 R / -0,158 R | 3052 | -0,182 R (-0,224 R a -0,139 R) | no |
| pivotes 3 · stop 1 ATR · objetivo 3 R | 7457 | 26,5 % | 0,87 | -0,113 R (-0,146 R a -0,079 R) | -0,033 R / -0,190 R | 3001 | -0,150 R (-0,202 R a -0,097 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 1,5 R | 7113 | 41,1 % | 0,88 | -0,078 R (-0,102 R a -0,055 R) | -0,034 R / -0,121 R | 2908 | -0,145 R (-0,182 R a -0,108 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 2 R | 6912 | 35,0 % | 0,89 | -0,079 R (-0,106 R a -0,051 R) | -0,034 R / -0,122 R | 2838 | -0,130 R (-0,173 R a -0,087 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 3 R | 6664 | 29,9 % | 0,95 | -0,040 R (-0,074 R a -0,006 R) | +0,025 R / -0,102 R | 2750 | -0,097 R (-0,150 R a -0,044 R) | no |
| pivotes 3 · stop 2 ATR · objetivo 1,5 R | 6507 | 41,7 % | 0,91 | -0,055 R (-0,079 R a -0,031 R) | -0,025 R / -0,084 R | 2678 | -0,105 R (-0,143 R a -0,067 R) | no |
| pivotes 3 · stop 2 ATR · objetivo 2 R | 6303 | 37,3 % | 0,94 | -0,041 R (-0,069 R a -0,014 R) | +0,006 R / -0,087 R | 2612 | -0,087 R (-0,131 R a -0,044 R) | no |
| pivotes 3 · stop 2 ATR · objetivo 3 R | 6094 | 33,5 % | 0,98 | -0,015 R (-0,048 R a +0,018 R) | +0,067 R / -0,093 R | 2511 | -0,080 R (-0,132 R a -0,029 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 1,5 R | 5560 | 42,8 % | 0,87 | -0,084 R (-0,111 R a -0,057 R) | -0,033 R / -0,132 R | 2150 | -0,172 R (-0,216 R a -0,129 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 2 R | 5515 | 36,2 % | 0,90 | -0,071 R (-0,103 R a -0,039 R) | -0,016 R / -0,123 R | 2137 | -0,166 R (-0,216 R a -0,115 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 3 R | 5443 | 27,8 % | 0,92 | -0,067 R (-0,107 R a -0,028 R) | +0,011 R / -0,142 R | 2113 | -0,123 R (-0,186 R a -0,060 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 1,5 R | 5240 | 42,7 % | 0,94 | -0,040 R (-0,068 R a -0,012 R) | -0,010 R / -0,068 R | 2041 | -0,131 R (-0,176 R a -0,087 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 2 R | 5155 | 36,7 % | 0,95 | -0,031 R (-0,063 R a +0,001 R) | +0,016 R / -0,076 R | 2016 | -0,111 R (-0,163 R a -0,060 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 3 R | 5045 | 30,9 % | 1,00 | +0,003 R (-0,036 R a +0,043 R) | +0,066 R / -0,057 R | 1977 | -0,066 R (-0,129 R a -0,003 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 1,5 R | 4898 | 42,9 % | 0,96 | -0,024 R (-0,052 R a +0,004 R) | +0,020 R / -0,065 R | 1928 | -0,093 R (-0,137 R a -0,048 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 2 R | 4814 | 38,4 % | 1,00 | +0,003 R (-0,030 R a +0,035 R) | +0,056 R / -0,047 R | 1901 | -0,051 R (-0,103 R a +0,000 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 3 R | 4701 | 34,2 % | 1,03 | +0,022 R (-0,016 R a +0,060 R) | +0,099 R / -0,051 R | 1853 | -0,060 R (-0,121 R a +0,000 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 1,5 R | 3797 | 43,5 % | 0,90 | -0,068 R (-0,101 R a -0,035 R) | +0,003 R / -0,137 R | 1471 | -0,158 R (-0,211 R a -0,105 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 2 R | 3784 | 36,9 % | 0,93 | -0,051 R (-0,090 R a -0,012 R) | +0,039 R / -0,139 R | 1468 | -0,123 R (-0,185 R a -0,061 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 3 R | 3755 | 29,1 % | 0,98 | -0,017 R (-0,065 R a +0,031 R) | +0,097 R / -0,129 R | 1458 | -0,127 R (-0,203 R a -0,051 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 1,5 R | 3661 | 43,6 % | 0,97 | -0,018 R (-0,052 R a +0,015 R) | +0,058 R / -0,093 R | 1431 | -0,098 R (-0,151 R a -0,045 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 2 R | 3622 | 37,9 % | 1,00 | +0,002 R (-0,037 R a +0,041 R) | +0,104 R / -0,099 R | 1421 | -0,107 R (-0,168 R a -0,045 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 3 R | 3577 | 31,6 % | 1,05 | +0,034 R (-0,013 R a +0,082 R) | +0,147 R / -0,076 R | 1411 | -0,092 R (-0,166 R a -0,018 R) | no |
| pivotes 8 · stop 2 ATR · objetivo 1,5 R | 3483 | 44,5 % | 1,03 | +0,015 R (-0,019 R a +0,049 R) | +0,115 R / -0,083 R | 1369 | -0,100 R (-0,153 R a -0,047 R) | no |
| pivotes 8 · stop 2 ATR · objetivo 2 R | 3447 | 39,4 % | 1,05 | +0,032 R (-0,007 R a +0,070 R) | +0,130 R / -0,065 R | 1362 | -0,101 R (-0,162 R a -0,041 R) | no |
| **pivotes 8 · stop 2 ATR · objetivo 3 R** | 3406 | 35,3 % | 1,11 | +0,071 R (+0,025 R a +0,117 R) | +0,197 R / -0,052 R | 1349 | -0,100 R (-0,170 R a -0,029 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,010 R sobre 2895 operaciones.

## 4h: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| NINGUNA | 2051 | 37,9 % | 1,09 | +0,057 R (+0,006 R a +0,108 R) | +0,060 R / +0,054 R | 947 | +0,057 R (-0,020 R a +0,133 R) | sí |
| **VOLUMEN** | 666 | 42,2 % | 1,31 | +0,180 R (+0,089 R a +0,272 R) | +0,341 R / +0,052 R | 352 | +0,066 R (-0,060 R a +0,193 R) | sí |
| CIERRE_FUERTE | 1508 | 38,7 % | 1,14 | +0,088 R (+0,027 R a +0,148 R) | +0,118 R / +0,057 R | 704 | +0,075 R (-0,014 R a +0,163 R) | sí |
| EMA200 | 1185 | 38,5 % | 1,11 | +0,068 R (+0,001 R a +0,136 R) | +0,129 R / +0,012 R | 565 | +0,208 R (+0,106 R a +0,309 R) | sí |
| HTF | 1230 | 38,5 % | 1,11 | +0,069 R (+0,003 R a +0,136 R) | +0,162 R / -0,016 R | 564 | +0,078 R (-0,022 R a +0,178 R) | no |
| CIERRE_SIGUIENTE | 1920 | 38,3 % | 1,11 | +0,072 R (+0,018 R a +0,125 R) | +0,133 R / +0,012 R | 878 | -0,004 R (-0,082 R a +0,074 R) | sí |
| REENTRADA | 1446 | 37,3 % | 1,04 | +0,027 R (-0,034 R a +0,087 R) | +0,013 R / +0,039 R | 634 | -0,005 R (-0,096 R a +0,087 R) | sí |

## 4h: fase 2, configuraciones (con VOLUMEN)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| pivotes 3 · stop 1 ATR · objetivo 1,5 R | 748 | 47,9 % | 1,23 | +0,126 R (+0,051 R a +0,201 R) | +0,111 R / +0,138 R | 366 | -0,096 R (-0,202 R a +0,010 R) | sí |
| pivotes 3 · stop 1 ATR · objetivo 2 R | 737 | 40,8 % | 1,23 | +0,147 R (+0,058 R a +0,236 R) | +0,181 R / +0,118 R | 361 | -0,181 R (-0,300 R a -0,061 R) | sí |
| pivotes 3 · stop 1 ATR · objetivo 3 R | 721 | 32,5 % | 1,26 | +0,184 R (+0,072 R a +0,295 R) | +0,236 R / +0,140 R | 355 | -0,110 R (-0,260 R a +0,039 R) | sí |
| pivotes 3 · stop 1,5 ATR · objetivo 1,5 R | 716 | 46,9 % | 1,22 | +0,119 R (+0,043 R a +0,194 R) | +0,148 R / +0,094 R | 341 | -0,061 R (-0,169 R a +0,047 R) | sí |
| pivotes 3 · stop 1,5 ATR · objetivo 2 R | 707 | 41,4 % | 1,25 | +0,153 R (+0,064 R a +0,242 R) | +0,221 R / +0,096 R | 339 | +0,025 R (-0,103 R a +0,152 R) | sí |
| pivotes 3 · stop 1,5 ATR · objetivo 3 R | 688 | 34,4 % | 1,28 | +0,188 R (+0,078 R a +0,298 R) | +0,322 R / +0,075 R | 331 | +0,005 R (-0,148 R a +0,159 R) | sí |
| pivotes 3 · stop 2 ATR · objetivo 1,5 R | 684 | 46,8 % | 1,20 | +0,107 R (+0,032 R a +0,182 R) | +0,186 R / +0,042 R | 331 | +0,012 R (-0,098 R a +0,122 R) | sí |
| pivotes 3 · stop 2 ATR · objetivo 2 R | 667 | 41,4 % | 1,21 | +0,121 R (+0,034 R a +0,208 R) | +0,248 R / +0,015 R | 324 | -0,009 R (-0,133 R a +0,115 R) | sí |
| pivotes 3 · stop 2 ATR · objetivo 3 R | 654 | 37,8 % | 1,28 | +0,167 R (+0,064 R a +0,270 R) | +0,327 R / +0,035 R | 315 | +0,088 R (-0,064 R a +0,241 R) | sí |
| pivotes 5 · stop 1 ATR · objetivo 1,5 R | 697 | 48,4 % | 1,24 | +0,134 R (+0,056 R a +0,212 R) | +0,206 R / +0,075 R | 369 | -0,094 R (-0,199 R a +0,011 R) | sí |
| pivotes 5 · stop 1 ATR · objetivo 2 R | 693 | 40,3 % | 1,20 | +0,128 R (+0,037 R a +0,220 R) | +0,245 R / +0,033 R | 367 | -0,060 R (-0,182 R a +0,063 R) | sí |
| pivotes 5 · stop 1 ATR · objetivo 3 R | 684 | 32,9 % | 1,30 | +0,211 R (+0,095 R a +0,327 R) | +0,375 R / +0,076 R | 364 | +0,028 R (-0,127 R a +0,182 R) | sí |
| pivotes 5 · stop 1,5 ATR · objetivo 1,5 R | 674 | 47,5 % | 1,24 | +0,131 R (+0,053 R a +0,209 R) | +0,264 R / +0,026 R | 354 | -0,004 R (-0,111 R a +0,104 R) | sí |
| pivotes 5 · stop 1,5 ATR · objetivo 2 R | 666 | 42,2 % | 1,31 | +0,180 R (+0,089 R a +0,272 R) | +0,341 R / +0,052 R | 352 | +0,066 R (-0,060 R a +0,193 R) | sí |
| **pivotes 5 · stop 1,5 ATR · objetivo 3 R** | 654 | 36,2 % | 1,39 | +0,250 R (+0,136 R a +0,364 R) | +0,505 R / +0,044 R | 336 | -0,013 R (-0,165 R a +0,138 R) | sí |
| pivotes 5 · stop 2 ATR · objetivo 1,5 R | 647 | 47,0 % | 1,22 | +0,117 R (+0,039 R a +0,194 R) | +0,254 R / +0,005 R | 341 | +0,055 R (-0,054 R a +0,165 R) | sí |
| pivotes 5 · stop 2 ATR · objetivo 2 R | 638 | 43,6 % | 1,34 | +0,186 R (+0,095 R a +0,276 R) | +0,379 R / +0,026 R | 331 | +0,031 R (-0,093 R a +0,156 R) | sí |
| pivotes 5 · stop 2 ATR · objetivo 3 R | 619 | 39,6 % | 1,41 | +0,243 R (+0,133 R a +0,352 R) | +0,493 R / +0,037 R | 319 | +0,029 R (-0,119 R a +0,177 R) | sí |
| pivotes 8 · stop 1 ATR · objetivo 1,5 R | 637 | 44,7 % | 1,08 | +0,046 R (-0,035 R a +0,127 R) | +0,112 R / -0,008 R | 295 | -0,078 R (-0,196 R a +0,040 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 2 R | 633 | 38,9 % | 1,13 | +0,087 R (-0,009 R a +0,182 R) | +0,164 R / +0,024 R | 294 | -0,066 R (-0,203 R a +0,070 R) | sí |
| pivotes 8 · stop 1 ATR · objetivo 3 R | 627 | 31,3 % | 1,22 | +0,161 R (+0,041 R a +0,282 R) | +0,234 R / +0,102 R | 294 | +0,052 R (-0,121 R a +0,225 R) | sí |
| pivotes 8 · stop 1,5 ATR · objetivo 1,5 R | 621 | 46,7 % | 1,20 | +0,109 R (+0,028 R a +0,191 R) | +0,202 R / +0,033 R | 288 | -0,002 R (-0,121 R a +0,117 R) | sí |
| pivotes 8 · stop 1,5 ATR · objetivo 2 R | 618 | 40,3 % | 1,25 | +0,151 R (+0,055 R a +0,247 R) | +0,253 R / +0,068 R | 287 | +0,092 R (-0,048 R a +0,232 R) | sí |
| pivotes 8 · stop 1,5 ATR · objetivo 3 R | 606 | 34,3 % | 1,29 | +0,195 R (+0,077 R a +0,312 R) | +0,335 R / +0,080 R | 279 | +0,040 R (-0,129 R a +0,210 R) | sí |
| pivotes 8 · stop 2 ATR · objetivo 1,5 R | 597 | 45,7 % | 1,19 | +0,103 R (+0,022 R a +0,185 R) | +0,227 R / +0,002 R | 273 | +0,052 R (-0,069 R a +0,174 R) | sí |
| pivotes 8 · stop 2 ATR · objetivo 2 R | 588 | 41,7 % | 1,26 | +0,149 R (+0,055 R a +0,243 R) | +0,286 R / +0,036 R | 270 | +0,023 R (-0,116 R a +0,161 R) | sí |
| pivotes 8 · stop 2 ATR · objetivo 3 R | 576 | 37,7 % | 1,27 | +0,165 R (+0,054 R a +0,276 R) | +0,365 R / +0,000 R | 262 | +0,028 R (-0,135 R a +0,192 R) | sí |

Control (entradas al azar, mismas fechas de evaluación): -0,020 R sobre 766 operaciones.

## 15m: fase 1, confirmaciones (configuración base)

| Confirmación | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| NINGUNA | 5156 | 34,9 % | 0,72 | -0,225 R (-0,257 R a -0,192 R) | -0,211 R / -0,238 R | 14334 | -0,231 R (-0,251 R a -0,212 R) | no |
| **VOLUMEN** | 1583 | 36,6 % | 0,77 | -0,179 R (-0,238 R a -0,120 R) | -0,169 R / -0,188 R | 4384 | -0,204 R (-0,240 R a -0,169 R) | no |
| CIERRE_FUERTE | 4045 | 35,5 % | 0,74 | -0,210 R (-0,247 R a -0,174 R) | -0,177 R / -0,244 R | 11295 | -0,231 R (-0,253 R a -0,210 R) | no |
| EMA200 | 3030 | 34,7 % | 0,72 | -0,231 R (-0,273 R a -0,188 R) | -0,195 R / -0,266 R | 8293 | -0,227 R (-0,253 R a -0,201 R) | no |
| HTF | 3155 | 34,6 % | 0,71 | -0,233 R (-0,275 R a -0,192 R) | -0,180 R / -0,287 R | 8829 | -0,238 R (-0,263 R a -0,214 R) | no |
| CIERRE_SIGUIENTE | 4581 | 34,3 % | 0,71 | -0,237 R (-0,271 R a -0,203 R) | -0,246 R / -0,228 R | 12747 | -0,258 R (-0,279 R a -0,238 R) | no |
| REENTRADA | 3568 | 32,5 % | 0,65 | -0,292 R (-0,330 R a -0,254 R) | -0,265 R / -0,320 R | 9783 | -0,240 R (-0,264 R a -0,217 R) | no |

## 15m: fase 2, configuraciones (con VOLUMEN)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| pivotes 3 · stop 1 ATR · objetivo 1,5 R | 1807 | 40,7 % | 0,55 | -0,370 R (-0,420 R a -0,321 R) | -0,325 R / -0,412 R | 5063 | -0,358 R (-0,388 R a -0,329 R) | no |
| pivotes 3 · stop 1 ATR · objetivo 2 R | 1792 | 34,5 % | 0,61 | -0,355 R (-0,412 R a -0,299 R) | -0,321 R / -0,387 R | 5031 | -0,333 R (-0,367 R a -0,299 R) | no |
| pivotes 3 · stop 1 ATR · objetivo 3 R | 1769 | 25,9 % | 0,64 | -0,367 R (-0,436 R a -0,298 R) | -0,370 R / -0,365 R | 4965 | -0,308 R (-0,350 R a -0,266 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 1,5 R | 1741 | 43,0 % | 0,74 | -0,185 R (-0,235 R a -0,136 R) | -0,179 R / -0,191 R | 4906 | -0,202 R (-0,231 R a -0,173 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 2 R | 1716 | 37,0 % | 0,78 | -0,170 R (-0,227 R a -0,113 R) | -0,186 R / -0,155 R | 4813 | -0,208 R (-0,241 R a -0,174 R) | no |
| pivotes 3 · stop 1,5 ATR · objetivo 3 R | 1678 | 30,8 % | 0,85 | -0,133 R (-0,203 R a -0,063 R) | -0,151 R / -0,116 R | 4694 | -0,164 R (-0,206 R a -0,123 R) | no |
| pivotes 3 · stop 2 ATR · objetivo 1,5 R | 1673 | 42,9 % | 0,79 | -0,139 R (-0,187 R a -0,090 R) | -0,138 R / -0,139 R | 4716 | -0,168 R (-0,197 R a -0,139 R) | no |
| pivotes 3 · stop 2 ATR · objetivo 2 R | 1641 | 38,4 % | 0,84 | -0,113 R (-0,169 R a -0,057 R) | -0,109 R / -0,116 R | 4620 | -0,142 R (-0,175 R a -0,108 R) | no |
| **pivotes 3 · stop 2 ATR · objetivo 3 R** | 1603 | 33,9 % | 0,89 | -0,085 R (-0,151 R a -0,019 R) | -0,112 R / -0,059 R | 4514 | -0,104 R (-0,144 R a -0,064 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 1,5 R | 1650 | 41,0 % | 0,56 | -0,356 R (-0,407 R a -0,305 R) | -0,325 R / -0,384 R | 4574 | -0,362 R (-0,393 R a -0,332 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 2 R | 1643 | 33,6 % | 0,59 | -0,376 R (-0,434 R a -0,317 R) | -0,368 R / -0,383 R | 4545 | -0,357 R (-0,393 R a -0,322 R) | no |
| pivotes 5 · stop 1 ATR · objetivo 3 R | 1627 | 26,1 % | 0,65 | -0,353 R (-0,425 R a -0,282 R) | -0,340 R / -0,366 R | 4495 | -0,311 R (-0,355 R a -0,267 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 1,5 R | 1606 | 42,5 % | 0,72 | -0,199 R (-0,250 R a -0,148 R) | -0,193 R / -0,204 R | 4448 | -0,220 R (-0,251 R a -0,190 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 2 R | 1583 | 36,6 % | 0,77 | -0,179 R (-0,238 R a -0,120 R) | -0,169 R / -0,188 R | 4384 | -0,204 R (-0,240 R a -0,169 R) | no |
| pivotes 5 · stop 1,5 ATR · objetivo 3 R | 1553 | 29,1 % | 0,78 | -0,191 R (-0,263 R a -0,120 R) | -0,174 R / -0,208 R | 4287 | -0,192 R (-0,235 R a -0,149 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 1,5 R | 1545 | 42,8 % | 0,79 | -0,139 R (-0,189 R a -0,088 R) | -0,138 R / -0,139 R | 4269 | -0,162 R (-0,192 R a -0,131 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 2 R | 1521 | 36,4 % | 0,78 | -0,164 R (-0,221 R a -0,106 R) | -0,141 R / -0,186 R | 4192 | -0,160 R (-0,195 R a -0,125 R) | no |
| pivotes 5 · stop 2 ATR · objetivo 3 R | 1488 | 32,2 % | 0,80 | -0,152 R (-0,219 R a -0,085 R) | -0,163 R / -0,141 R | 4100 | -0,151 R (-0,192 R a -0,110 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 1,5 R | 1375 | 42,4 % | 0,59 | -0,329 R (-0,385 R a -0,273 R) | -0,318 R / -0,339 R | 3884 | -0,364 R (-0,397 R a -0,330 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 2 R | 1371 | 35,7 % | 0,64 | -0,321 R (-0,386 R a -0,256 R) | -0,319 R / -0,323 R | 3870 | -0,343 R (-0,382 R a -0,305 R) | no |
| pivotes 8 · stop 1 ATR · objetivo 3 R | 1362 | 26,7 % | 0,67 | -0,332 R (-0,412 R a -0,253 R) | -0,308 R / -0,356 R | 3840 | -0,335 R (-0,383 R a -0,288 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 1,5 R | 1353 | 43,1 % | 0,75 | -0,182 R (-0,238 R a -0,126 R) | -0,156 R / -0,207 R | 3794 | -0,211 R (-0,244 R a -0,178 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 2 R | 1341 | 36,2 % | 0,77 | -0,184 R (-0,248 R a -0,119 R) | -0,140 R / -0,227 R | 3760 | -0,199 R (-0,238 R a -0,161 R) | no |
| pivotes 8 · stop 1,5 ATR · objetivo 3 R | 1317 | 28,5 % | 0,78 | -0,197 R (-0,275 R a -0,119 R) | -0,104 R / -0,290 R | 3702 | -0,190 R (-0,236 R a -0,144 R) | no |
| pivotes 8 · stop 2 ATR · objetivo 1,5 R | 1310 | 42,9 % | 0,80 | -0,130 R (-0,186 R a -0,075 R) | -0,110 R / -0,150 R | 3693 | -0,148 R (-0,180 R a -0,115 R) | no |
| pivotes 8 · stop 2 ATR · objetivo 2 R | 1292 | 36,5 % | 0,80 | -0,151 R (-0,214 R a -0,088 R) | -0,132 R / -0,170 R | 3646 | -0,131 R (-0,169 R a -0,094 R) | no |
| pivotes 8 · stop 2 ATR · objetivo 3 R | 1270 | 31,5 % | 0,80 | -0,156 R (-0,229 R a -0,082 R) | -0,109 R / -0,201 R | 3588 | -0,141 R (-0,185 R a -0,098 R) | no |

Control (entradas al azar, mismas fechas de evaluación): -0,294 R sobre 11260 operaciones.
