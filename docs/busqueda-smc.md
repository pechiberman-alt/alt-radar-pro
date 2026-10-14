# Búsqueda del gatillo y la configuración: zonas altas + toma de liquidez + IFVG + breaker

Generado el 2026-10-14 con `scripts/investigacion/smc-busqueda.ts`. Velas de Binance de 10 monedas (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, TRXUSDT, BCHUSDT, ZECUSDT) en 1 h, 4 h y 15 min, del 2020-01-01 al 2026-09-30. Desarrollo hasta el 2024-09-21, evaluación después: el mismo corte que el estudio (`docs/estudio-estrategias.md`). Costos: 0,07 % por lado. Horizonte: 48 velas. Escalera de la app: si una vela toca stop y objetivo, cuenta el stop.

## Qué se buscó

Zonas de la temporalidad alta: FVG (la primera y la tercera vela alta no se tocan, hueco de 0,5 ATR o más) y order blocks (la última vela contraria antes de un impulso de 3 velas de 1,5 ATR o más que rompe la estructura de 20 velas). La alta es de 4 h para series de 1 h y 15 min, y diaria para la de 4 h. Una zona se conoce solo al cierre de su vela alta y vence a las 40 velas altas o cuando una vela alta cierra del otro lado de su borde lejano. Con el precio dentro de una zona viva, el gatillo es una toma de liquidez (una mecha que pasa un pivote de 3 velas ya confirmado y cierra de vuelta), un IFVG (un hueco de valor justo de 0,3 ATR o más que una vela cierra por el otro lado) y un breaker (un order block que el precio cierra por el otro lado), los tres en el mismo sentido y dentro de 12 velas de la toma. Una señal por toma. Stop a un margen más allá del extremo de la toma; si queda a más de 4 ATR no se opera. La entrada es la apertura de la vela siguiente al gatillo.

- **Fase 1, disparos** (con la configuración base: zonas FVG y OB, margen 0,5 ATR, objetivo 2 R):
  - **ZONA**: Sin gatillo: la primera vela que toca la zona alta y cierra del lado favorable (la vara con la que se comparan los demás).
  - **BARRIDA**: Dentro de la zona, una vela rompe con la mecha un máximo o mínimo de pivote y cierra de vuelta (toma de liquidez). Entra en esa vela.
  - **BARRIDA_IFVG**: La toma de liquidez y, hasta 12 velas después, un IFVG a favor (un hueco de valor justo cerrado por el otro lado). Entra en el cierre del IFVG.
  - **BARRIDA_BREAKER**: La toma de liquidez y, hasta 12 velas después, un breaker a favor (un order block roto por un cierre). Entra en el cierre de la rotura.
  - **BARRIDA_IFVG_BREAKER**: La toma de liquidez y, hasta 12 velas después, las dos cosas: un IFVG y un breaker a favor. Entra en el cierre de la última. Es el gatillo del agente.
  - **IFVG_BREAKER**: Sin toma de liquidez: un IFVG y un breaker a favor a menos de 12 velas uno del otro, con la zona alta tocada en ese tramo.
- **Fase 2, configuraciones** (con el disparo elegido en la fase 1): zonas FVG, OB o ambas × margen del stop de 0,25, 0,5 o 1 ATR × objetivo de 1,5, 2 o 3 R. Son 27; la base ya está en la fase 1.
- **Fase 3, filtros** (sobre el agente fijado de antemano: BARRIDA_IFVG_BREAKER, configuración base): PERFIL (cierre del lado favorable del POC del perfil de volumen de 200 velas), SUPERTREND (dirección 10, 3 a favor), EMAS (medias de 9, 21, 30, 50 y 100 apiladas a favor) y TODO (los tres a la vez). Se muestran los cuatro; no se elige ninguno, y el agente "Liquidez + Perfil + Supertrend + EMAs" se mide con TODO como se pidió.
- **Elección**: solo con el DESARROLLO. Candidata = al menos 100 operaciones y expectancia positiva en cada mitad del desarrollo (con 30 o más en cada una). Entre las candidatas, gana la de piso más alto del intervalo del 90 % de la expectancia. Si ninguna es candidata, se muestra la de piso más alto, marcada como no estable.
- **Contabilidad**: 32 variantes distintas por temporalidad, 108 en total. El DSR de esta búsqueda cuenta esas 108; el declarado del estudio pasa a 550 (400 de antes, más estas 108, redondeado para arriba).

## Cómo leerlo

- Todo lo de desarrollo se eligió sin mirar la evaluación. Pero **el período de evaluación ya se miró** con otras estrategias (el estudio y las búsquedas de la línea de tendencia y del breaker block usan el mismo corte y las mismas monedas), y el declarado de ensayos lo cuenta. Esta es la primera vez que se mide esta combinación, pero los números de evaluación no son una prueba limpia.
- La búsqueda es **escalonada**: el disparo se elige con la base y después se busca la configuración. Una búsqueda conjunta (6 × 27 por temporalidad) podría dar otra combinación, y contaría más variantes.
- Los umbrales (hueco de 0,5 ATR, impulso de 3 velas de 1,5 ATR, 20 velas de estructura, 40 de vida de la zona, pivote de 3 velas de 60 de vida, ventana de 12 velas, IFVG de 0,3 ATR, desplazamiento del breaker de 1,8 ATR, riesgo máximo de 4 ATR) son fijos: no se afinaron. Cambiarlos sería otra variante, y entraría en la cuenta.
- La detección es propia de esta medición y causal: no usa las de `lib/order-blocks.ts` ni `lib/fair-value-gaps.ts`, que sirven para dibujar y miran velas posteriores. Las zonas altas se arman solo con velas altas ya cerradas.
- Los intervalos son del 90 %: media ± 1,645 errores estándar de la expectancia. Un intervalo que cruza cero no da conclusión.
- Es una medición del pasado, con costos. No garantiza resultados futuros y no es asesoramiento financiero. La única prueba limpia es la medición hacia adelante en papel, que todavía no existe para esta variante.

## Resumen por temporalidad

- **1h**: **IFVG_BREAKER** con zonas FVG · margen 1 ATR · objetivo 3 R. En desarrollo, 243 operaciones con expectancia +0,178 R (IC +0,037 R a +0,320 R). En evaluación: 152 operaciones, expectancia +0,045 R (IC -0,140 R a +0,229 R), acierto 42,8 %, profit factor 1,08. DSR con N = 108: 0,0 %. Veredicto: SIN CONCLUSIÓN.
- **4h**: **IFVG_BREAKER** con zonas OB · margen 0,25 ATR · objetivo 3 R. En desarrollo, 136 operaciones con expectancia +0,313 R (IC +0,103 R a +0,523 R). En evaluación: muestra chica, expectancia -0,026 R (IC -0,279 R a +0,226 R), acierto 42,6 %, profit factor 0,95. DSR con N = 108: 0,0 %. Veredicto: SIN CONCLUSIÓN.
- **15m**: ninguna configuración es estable en el desarrollo. La de mayor piso del intervalo es **IFVG_BREAKER** con zonas FVG y OB · margen 1 ATR · objetivo 3 R, y queda marcada como no estable. En evaluación: 1359 operaciones, expectancia -0,181 R (IC -0,235 R a -0,128 R), veredicto SIN VENTAJA.
- **Para transparencia**: entre las 108 variantes, la de mejor expectancia en evaluación es **IFVG_BREAKER** con zonas FVG y OB · margen 0,5 ATR · objetivo 3 R en 4h (103 operaciones, expectancia +0,258 R, IC +0,035 R a +0,482 R). No es la que eligió la regla de desarrollo, y como la evaluación ya se miró, se muestra como dato y no como resultado. Con las 108 variantes, el Reality Check da p = 0,79 y el SPA p = 0,30: no alcanza para distinguirla de la suerte (el SPA es el más confiable cuando las variantes tienen varianzas distintas).

## Auditoría de sobreajuste

Variantes de la búsqueda: 108. Ensayos declarados del estudio: 550. Varianza de los Sharpe por operación entre las 108 variantes en evaluación: 0,0335. Días de evaluación: 740.

| Temporalidad | Elegida | PSR (evaluación) | DSR (N = búsqueda) | DSR (N declarado) | Veredicto |
|---|---|---|---|---|---|
| 1h | IFVG_BREAKER · zonas FVG · margen 1 ATR · objetivo 3 R | 65,7 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| 4h | IFVG_BREAKER · zonas OB · margen 0,25 ATR · objetivo 3 R | 43,3 % | 0,0 % | 0,0 % | SIN CONCLUSIÓN |
| 15m | IFVG_BREAKER · zonas FVG y OB · margen 1 ATR · objetivo 3 R | 0,0 % | 0,0 % | 0,0 % | SIN VENTAJA |

Reality Check de White y SPA de Hansen sobre el resultado diario en evaluación de las 108 variantes (bootstrap estacionario, 5.000 remuestreos, bloques de 10 días): p = 0,79 (Reality Check) y p = 0,30 (SPA). La pregunta: ¿alguna variante le gana a no operar, contando que se eligió la mejor entre todas? Con p menor a 0,05 la respuesta es sí. Como la evaluación ya se miró, esto corrige por la búsqueda pero no por esa mirada previa.

Un DSR menor a 95 % no alcanza para decir que hay ventaja. Una VENTAJA con DSR declarado menor a 95 % baja a CANDIDATA.

## 1h: fase 1, disparoes (configuración base)

| Disparo | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| ZONA | 7481 | 35,2 % | 0,87 | -0,090 R (-0,117 R a -0,064 R) | -0,065 R / -0,114 R | 3418 | -0,103 R (-0,143 R a -0,063 R) | no |
| BARRIDA | 6690 | 33,7 % | 0,79 | -0,155 R (-0,182 R a -0,127 R) | -0,087 R / -0,219 R | 2976 | -0,236 R (-0,278 R a -0,195 R) | no |
| BARRIDA_IFVG | 1404 | 39,2 % | 0,97 | -0,018 R (-0,073 R a +0,036 R) | +0,036 R / -0,073 R | 637 | -0,131 R (-0,210 R a -0,051 R) | no |
| BARRIDA_BREAKER | 1065 | 37,2 % | 0,82 | -0,103 R (-0,161 R a -0,045 R) | +0,027 R / -0,226 R | 470 | -0,126 R (-0,214 R a -0,038 R) | no |
| BARRIDA_IFVG_BREAKER | 470 | 40,9 % | 1,00 | +0,001 R (-0,087 R a +0,090 R) | +0,109 R / -0,110 R | 223 | -0,059 R (-0,187 R a +0,069 R) | no |
| **IFVG_BREAKER** | 705 | 40,6 % | 1,02 | +0,008 R (-0,066 R a +0,083 R) | +0,128 R / -0,107 R | 371 | -0,074 R (-0,178 R a +0,031 R) | no |

## 1h: fase 2, configuraciones (con IFVG_BREAKER)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| zonas FVG · margen 0,25 ATR · objetivo 1,5 R | 375 | 48,3 % | 1,20 | +0,093 R (-0,002 R a +0,188 R) | +0,254 R / -0,062 R | 226 | -0,019 R (-0,144 R a +0,106 R) | no |
| zonas FVG · margen 0,25 ATR · objetivo 2 R | 375 | 44,8 % | 1,21 | +0,105 R (-0,000 R a +0,210 R) | +0,259 R / -0,043 R | 225 | +0,018 R (-0,123 R a +0,158 R) | no |
| zonas FVG · margen 0,25 ATR · objetivo 3 R | 375 | 42,9 % | 1,24 | +0,127 R (+0,007 R a +0,246 R) | +0,284 R / -0,025 R | 224 | +0,092 R (-0,070 R a +0,254 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 1,5 R | 333 | 46,2 % | 1,18 | +0,086 R (-0,013 R a +0,186 R) | +0,181 R / -0,005 R | 205 | -0,020 R (-0,149 R a +0,108 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 2 R | 333 | 43,8 % | 1,22 | +0,109 R (-0,002 R a +0,219 R) | +0,214 R / +0,006 R | 205 | +0,007 R (-0,136 R a +0,150 R) | sí |
| zonas FVG · margen 0,5 ATR · objetivo 3 R | 333 | 41,7 % | 1,23 | +0,117 R (-0,007 R a +0,242 R) | +0,212 R / +0,026 R | 205 | +0,086 R (-0,079 R a +0,252 R) | sí |
| zonas FVG · margen 1 ATR · objetivo 1,5 R | 243 | 48,1 % | 1,30 | +0,130 R (+0,017 R a +0,243 R) | +0,174 R / +0,088 R | 153 | -0,039 R (-0,186 R a +0,108 R) | sí |
| zonas FVG · margen 1 ATR · objetivo 2 R | 243 | 46,9 % | 1,37 | +0,160 R (+0,035 R a +0,285 R) | +0,250 R / +0,077 R | 152 | +0,011 R (-0,155 R a +0,176 R) | sí |
| **zonas FVG · margen 1 ATR · objetivo 3 R** | 243 | 44,9 % | 1,39 | +0,178 R (+0,037 R a +0,320 R) | +0,203 R / +0,156 R | 152 | +0,045 R (-0,140 R a +0,229 R) | sí |
| zonas OB · margen 0,25 ATR · objetivo 1,5 R | 453 | 42,2 % | 0,90 | -0,056 R (-0,141 R a +0,030 R) | +0,052 R / -0,156 R | 218 | -0,166 R (-0,288 R a -0,044 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 2 R | 452 | 38,9 % | 0,92 | -0,046 R (-0,141 R a +0,048 R) | +0,108 R / -0,191 R | 218 | -0,176 R (-0,309 R a -0,043 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 3 R | 452 | 36,9 % | 0,91 | -0,052 R (-0,156 R a +0,052 R) | +0,133 R / -0,226 R | 217 | -0,121 R (-0,274 R a +0,032 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 1,5 R | 416 | 40,9 % | 0,85 | -0,080 R (-0,168 R a +0,007 R) | +0,025 R / -0,180 R | 196 | -0,197 R (-0,325 R a -0,070 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 2 R | 416 | 38,2 % | 0,88 | -0,067 R (-0,163 R a +0,030 R) | +0,068 R / -0,194 R | 195 | -0,154 R (-0,295 R a -0,013 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 3 R | 416 | 37,0 % | 0,92 | -0,046 R (-0,152 R a +0,060 R) | +0,121 R / -0,203 R | 195 | -0,119 R (-0,279 R a +0,041 R) | no |
| zonas OB · margen 1 ATR · objetivo 1,5 R | 311 | 42,1 % | 0,89 | -0,056 R (-0,155 R a +0,043 R) | +0,065 R / -0,166 R | 145 | -0,238 R (-0,383 R a -0,093 R) | no |
| zonas OB · margen 1 ATR · objetivo 2 R | 310 | 39,7 % | 0,88 | -0,065 R (-0,170 R a +0,041 R) | +0,074 R / -0,191 R | 145 | -0,174 R (-0,337 R a -0,012 R) | no |
| zonas OB · margen 1 ATR · objetivo 3 R | 310 | 39,0 % | 0,92 | -0,040 R (-0,156 R a +0,075 R) | +0,128 R / -0,194 R | 145 | -0,148 R (-0,331 R a +0,036 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 1,5 R | 774 | 44,6 % | 1,02 | +0,010 R (-0,055 R a +0,076 R) | +0,141 R / -0,114 R | 410 | -0,082 R (-0,173 R a +0,010 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 2 R | 773 | 41,1 % | 1,03 | +0,017 R (-0,055 R a +0,090 R) | +0,172 R / -0,130 R | 409 | -0,076 R (-0,177 R a +0,026 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 3 R | 773 | 39,1 % | 1,03 | +0,019 R (-0,061 R a +0,100 R) | +0,185 R / -0,139 R | 407 | -0,021 R (-0,137 R a +0,095 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 1,5 R | 705 | 43,1 % | 0,98 | -0,008 R (-0,075 R a +0,060 R) | +0,095 R / -0,106 R | 372 | -0,103 R (-0,197 R a -0,008 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 2 R | 705 | 40,6 % | 1,02 | +0,008 R (-0,066 R a +0,083 R) | +0,128 R / -0,107 R | 371 | -0,074 R (-0,178 R a +0,031 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 3 R | 705 | 38,9 % | 1,03 | +0,017 R (-0,065 R a +0,100 R) | +0,147 R / -0,106 R | 371 | -0,028 R (-0,146 R a +0,091 R) | no |
| zonas FVG y OB · margen 1 ATR · objetivo 1,5 R | 523 | 44,7 % | 1,06 | +0,029 R (-0,048 R a +0,105 R) | +0,126 R / -0,061 R | 276 | -0,128 R (-0,236 R a -0,021 R) | no |
| zonas FVG y OB · margen 1 ATR · objetivo 2 R | 522 | 42,7 % | 1,07 | +0,036 R (-0,048 R a +0,119 R) | +0,161 R / -0,079 R | 275 | -0,073 R (-0,193 R a +0,048 R) | no |
| zonas FVG y OB · margen 1 ATR · objetivo 3 R | 522 | 41,4 % | 1,11 | +0,055 R (-0,037 R a +0,148 R) | +0,172 R / -0,052 R | 275 | -0,046 R (-0,181 R a +0,089 R) | no |

## 1h: fase 3, filtros de contexto (disparo BARRIDA_IFVG_BREAKER, configuración base)

| Filtro | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Acierto (evaluación) | PF (evaluación) |
|---|---|---|---|---|---|---|---|---|---|
| NINGUNO (el agente sin filtro) | 470 | 40,9 % | 1,00 | +0,001 R (-0,087 R a +0,090 R) | +0,109 R / -0,110 R | 223 | -0,059 R (-0,187 R a +0,069 R) | 42,2 % | 0,89 |
| PERFIL | 365 | 40,5 % | 1,08 | +0,042 R (-0,060 R a +0,145 R) | +0,167 R / -0,100 R | 177 | +0,001 R (-0,144 R a +0,146 R) | 44,1 % | 1,00 |
| SUPERTREND | 165 | 41,2 % | 0,99 | -0,004 R (-0,155 R a +0,147 R) | +0,095 R / -0,136 R | 70 | +0,060 R (-0,172 R a +0,292 R) | 42,9 % | 1,13 |
| EMAS | 113 | 36,3 % | 0,89 | -0,063 R (-0,250 R a +0,124 R) | +0,009 R / -0,159 R | 43 | +0,272 R (-0,063 R a +0,608 R) | 48,8 % | 1,57 |
| TODO | 77 | 28,6 % | 0,61 | -0,258 R (-0,472 R a -0,045 R) | -0,149 R / -0,439 R | 29 | +0,248 R (-0,163 R a +0,658 R) | 48,3 % | 1,51 |

Control (entradas al azar, mismas fechas de evaluación): -0,010 R sobre 2895 operaciones.

## 4h: fase 1, disparoes (configuración base)

| Disparo | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| ZONA | 1216 | 37,3 % | 1,04 | +0,028 R (-0,038 R a +0,094 R) | +0,088 R / -0,029 R | 550 | +0,103 R (+0,002 R a +0,205 R) | no |
| BARRIDA | 1540 | 34,7 % | 0,92 | -0,056 R (-0,114 R a +0,002 R) | -0,057 R / -0,055 R | 609 | -0,060 R (-0,153 R a +0,033 R) | no |
| BARRIDA_IFVG | 341 | 41,3 % | 0,98 | -0,008 R (-0,110 R a +0,095 R) | +0,091 R / -0,092 R | 148 | +0,125 R (-0,047 R a +0,296 R) | no |
| BARRIDA_BREAKER | 287 | 44,6 % | 1,10 | +0,046 R (-0,067 R a +0,158 R) | +0,138 R / -0,032 R | 123 | +0,078 R (-0,105 R a +0,261 R) | no |
| BARRIDA_IFVG_BREAKER | 140 | 49,3 % | 1,28 | +0,116 R (-0,040 R a +0,273 R) | +0,254 R / -0,003 R | 58 | +0,187 R (-0,089 R a +0,462 R) | no |
| **IFVG_BREAKER** | 217 | 47,5 % | 1,32 | +0,143 R (+0,009 R a +0,276 R) | +0,128 R / +0,157 R | 103 | +0,238 R (+0,038 R a +0,438 R) | sí |

## 4h: fase 2, configuraciones (con IFVG_BREAKER)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| zonas FVG · margen 0,25 ATR · objetivo 1,5 R | 110 | 48,2 % | 1,14 | +0,067 R (-0,104 R a +0,239 R) | -0,030 R / +0,151 R | 45 | +0,410 R (+0,134 R a +0,686 R) | no |
| zonas FVG · margen 0,25 ATR · objetivo 2 R | 110 | 45,5 % | 1,19 | +0,088 R (-0,096 R a +0,272 R) | +0,002 R / +0,162 R | 44 | +0,444 R (+0,120 R a +0,768 R) | sí |
| zonas FVG · margen 0,25 ATR · objetivo 3 R | 109 | 44,0 % | 1,29 | +0,142 R (-0,073 R a +0,357 R) | +0,011 R / +0,253 R | 44 | +0,559 R (+0,179 R a +0,940 R) | sí |
| zonas FVG · margen 0,5 ATR · objetivo 1,5 R | 102 | 49,0 % | 1,14 | +0,064 R (-0,107 R a +0,234 R) | -0,021 R / +0,139 R | 43 | +0,373 R (+0,102 R a +0,645 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 2 R | 102 | 46,1 % | 1,20 | +0,090 R (-0,099 R a +0,278 R) | -0,039 R / +0,205 R | 42 | +0,444 R (+0,118 R a +0,769 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 3 R | 102 | 46,1 % | 1,36 | +0,162 R (-0,053 R a +0,377 R) | +0,046 R / +0,265 R | 42 | +0,545 R (+0,162 R a +0,928 R) | sí |
| zonas FVG · margen 1 ATR · objetivo 1,5 R | 77 | 46,8 % | 1,19 | +0,078 R (-0,111 R a +0,266 R) | -0,050 R / +0,190 R | 29 | +0,257 R (-0,071 R a +0,586 R) | no |
| zonas FVG · margen 1 ATR · objetivo 2 R | 77 | 46,8 % | 1,37 | +0,149 R (-0,063 R a +0,361 R) | +0,033 R / +0,250 R | 29 | +0,399 R (+0,016 R a +0,781 R) | no |
| zonas FVG · margen 1 ATR · objetivo 3 R | 77 | 46,8 % | 1,55 | +0,223 R (-0,018 R a +0,463 R) | +0,121 R / +0,313 R | 29 | +0,591 R (+0,120 R a +1,061 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 1,5 R | 137 | 51,8 % | 1,47 | +0,198 R (+0,041 R a +0,355 R) | +0,165 R / +0,230 R | 68 | +0,016 R (-0,209 R a +0,241 R) | sí |
| zonas OB · margen 0,25 ATR · objetivo 2 R | 136 | 50,0 % | 1,58 | +0,255 R (+0,076 R a +0,435 R) | +0,300 R / +0,210 R | 68 | +0,014 R (-0,226 R a +0,254 R) | sí |
| **zonas OB · margen 0,25 ATR · objetivo 3 R** | 136 | 47,8 % | 1,68 | +0,313 R (+0,103 R a +0,523 R) | +0,430 R / +0,196 R | 68 | -0,026 R (-0,279 R a +0,226 R) | sí |
| zonas OB · margen 0,5 ATR · objetivo 1,5 R | 127 | 52,0 % | 1,42 | +0,170 R (+0,012 R a +0,329 R) | +0,165 R / +0,176 R | 66 | +0,094 R (-0,132 R a +0,319 R) | sí |
| zonas OB · margen 0,5 ATR · objetivo 2 R | 127 | 49,6 % | 1,50 | +0,218 R (+0,038 R a +0,399 R) | +0,237 R / +0,200 R | 66 | +0,062 R (-0,175 R a +0,298 R) | sí |
| zonas OB · margen 0,5 ATR · objetivo 3 R | 127 | 48,0 % | 1,59 | +0,266 R (+0,058 R a +0,473 R) | +0,381 R / +0,155 R | 66 | +0,029 R (-0,220 R a +0,277 R) | sí |
| zonas OB · margen 1 ATR · objetivo 1,5 R | 98 | 56,1 % | 1,59 | +0,220 R (+0,044 R a +0,397 R) | +0,194 R / +0,247 R | 49 | -0,007 R (-0,267 R a +0,253 R) | no |
| zonas OB · margen 1 ATR · objetivo 2 R | 98 | 54,1 % | 1,62 | +0,244 R (+0,048 R a +0,441 R) | +0,245 R / +0,244 R | 49 | +0,053 R (-0,233 R a +0,340 R) | no |
| zonas OB · margen 1 ATR · objetivo 3 R | 98 | 53,1 % | 1,71 | +0,285 R (+0,062 R a +0,507 R) | +0,353 R / +0,217 R | 49 | +0,032 R (-0,279 R a +0,343 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 1,5 R | 236 | 49,6 % | 1,26 | +0,117 R (-0,001 R a +0,236 R) | +0,083 R / +0,152 R | 108 | +0,202 R (+0,021 R a +0,383 R) | sí |
| zonas FVG y OB · margen 0,25 ATR · objetivo 2 R | 234 | 47,4 % | 1,35 | +0,159 R (+0,027 R a +0,291 R) | +0,184 R / +0,134 R | 107 | +0,213 R (+0,011 R a +0,414 R) | sí |
| zonas FVG y OB · margen 0,25 ATR · objetivo 3 R | 233 | 45,5 % | 1,46 | +0,219 R (+0,065 R a +0,374 R) | +0,266 R / +0,173 R | 107 | +0,234 R (+0,009 R a +0,459 R) | sí |
| zonas FVG y OB · margen 0,5 ATR · objetivo 1,5 R | 218 | 50,0 % | 1,24 | +0,102 R (-0,016 R a +0,221 R) | +0,085 R / +0,120 R | 104 | +0,231 R (+0,052 R a +0,411 R) | sí |
| zonas FVG y OB · margen 0,5 ATR · objetivo 2 R | 217 | 47,5 % | 1,32 | +0,143 R (+0,009 R a +0,276 R) | +0,128 R / +0,157 R | 103 | +0,238 R (+0,038 R a +0,438 R) | sí |
| zonas FVG y OB · margen 0,5 ATR · objetivo 3 R | 217 | 46,5 % | 1,45 | +0,206 R (+0,052 R a +0,360 R) | +0,249 R / +0,164 R | 103 | +0,258 R (+0,035 R a +0,482 R) | sí |
| zonas FVG y OB · margen 1 ATR · objetivo 1,5 R | 166 | 51,2 % | 1,34 | +0,134 R (+0,002 R a +0,266 R) | +0,092 R / +0,178 R | 74 | +0,107 R (-0,106 R a +0,320 R) | sí |
| zonas FVG y OB · margen 1 ATR · objetivo 2 R | 166 | 50,0 % | 1,45 | +0,185 R (+0,036 R a +0,333 R) | +0,158 R / +0,212 R | 74 | +0,202 R (-0,038 R a +0,442 R) | sí |
| zonas FVG y OB · margen 1 ATR · objetivo 3 R | 166 | 49,4 % | 1,58 | +0,239 R (+0,071 R a +0,408 R) | +0,258 R / +0,221 R | 74 | +0,263 R (-0,014 R a +0,541 R) | sí |

## 4h: fase 3, filtros de contexto (disparo BARRIDA_IFVG_BREAKER, configuración base)

| Filtro | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Acierto (evaluación) | PF (evaluación) |
|---|---|---|---|---|---|---|---|---|---|
| NINGUNO (el agente sin filtro) | 140 | 49,3 % | 1,28 | +0,116 R (-0,040 R a +0,273 R) | +0,254 R / -0,003 R | 58 | +0,187 R (-0,089 R a +0,462 R) | 48,3 % | 1,39 |
| PERFIL | 105 | 45,7 % | 1,10 | +0,044 R (-0,133 R a +0,222 R) | +0,217 R / -0,112 R | 46 | +0,198 R (-0,113 R a +0,509 R) | 50,0 % | 1,41 |
| SUPERTREND | 41 | 43,9 % | 1,00 | -0,000 R (-0,288 R a +0,287 R) | +0,414 R / -0,358 R | 12 | +0,183 R (-0,433 R a +0,800 R) | 50,0 % | 1,39 |
| EMAS | 31 | 48,4 % | 1,17 | +0,082 R (-0,279 R a +0,444 R) | +0,429 R / -0,168 R | 9 | +0,673 R (-0,059 R a +1,405 R) | 66,7 % | 2,99 |
| TODO | 19 | 42,1 % | 0,99 | -0,005 R (-0,463 R a +0,454 R) | +0,342 R / -0,207 R | 4 | +0,988 R (-0,175 R a +2,150 R) | 75,0 % | 4,92 |

Control (entradas al azar, mismas fechas de evaluación): -0,020 R sobre 766 operaciones.

## 15m: fase 1, disparoes (configuración base)

| Disparo | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| ZONA | 1338 | 36,6 % | 0,74 | -0,202 R (-0,265 R a -0,139 R) | -0,171 R / -0,232 R | 3948 | -0,330 R (-0,366 R a -0,294 R) | no |
| BARRIDA | 2862 | 33,2 % | 0,60 | -0,349 R (-0,392 R a -0,306 R) | -0,263 R / -0,433 R | 8382 | -0,393 R (-0,418 R a -0,368 R) | no |
| BARRIDA_IFVG | 765 | 38,6 % | 0,78 | -0,134 R (-0,206 R a -0,063 R) | -0,093 R / -0,177 R | 2399 | -0,149 R (-0,191 R a -0,108 R) | no |
| BARRIDA_BREAKER | 620 | 35,6 % | 0,68 | -0,198 R (-0,273 R a -0,123 R) | -0,172 R / -0,224 R | 1703 | -0,261 R (-0,306 R a -0,216 R) | no |
| BARRIDA_IFVG_BREAKER | 270 | 37,8 % | 0,77 | -0,129 R (-0,243 R a -0,014 R) | -0,108 R / -0,149 R | 832 | -0,291 R (-0,353 R a -0,229 R) | no |
| **IFVG_BREAKER** | 608 | 39,3 % | 0,85 | -0,085 R (-0,164 R a -0,005 R) | -0,043 R / -0,119 R | 1882 | -0,149 R (-0,193 R a -0,105 R) | no |

## 15m: fase 2, configuraciones (con IFVG_BREAKER)

| Configuración | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Estable |
|---|---|---|---|---|---|---|---|---|
| zonas FVG · margen 0,25 ATR · objetivo 1,5 R | 365 | 41,6 % | 0,82 | -0,100 R (-0,195 R a -0,006 R) | -0,052 R / -0,136 R | 1090 | -0,090 R (-0,145 R a -0,035 R) | no |
| zonas FVG · margen 0,25 ATR · objetivo 2 R | 364 | 39,6 % | 0,95 | -0,031 R (-0,140 R a +0,077 R) | +0,028 R / -0,074 R | 1087 | -0,060 R (-0,122 R a +0,002 R) | no |
| zonas FVG · margen 0,25 ATR · objetivo 3 R | 363 | 37,5 % | 0,97 | -0,016 R (-0,139 R a +0,106 R) | +0,073 R / -0,082 R | 1082 | -0,039 R (-0,108 R a +0,030 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 1,5 R | 325 | 43,7 % | 0,93 | -0,036 R (-0,137 R a +0,066 R) | +0,033 R / -0,087 R | 984 | -0,091 R (-0,149 R a -0,034 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 2 R | 323 | 40,6 % | 0,98 | -0,009 R (-0,123 R a +0,106 R) | +0,052 R / -0,054 R | 981 | -0,082 R (-0,145 R a -0,019 R) | no |
| zonas FVG · margen 0,5 ATR · objetivo 3 R | 323 | 38,7 % | 1,02 | +0,010 R (-0,118 R a +0,138 R) | +0,127 R / -0,078 R | 978 | -0,059 R (-0,129 R a +0,011 R) | no |
| zonas FVG · margen 1 ATR · objetivo 1,5 R | 238 | 43,3 % | 0,93 | -0,036 R (-0,152 R a +0,080 R) | +0,090 R / -0,126 R | 716 | -0,139 R (-0,204 R a -0,074 R) | no |
| zonas FVG · margen 1 ATR · objetivo 2 R | 238 | 41,2 % | 0,99 | -0,005 R (-0,134 R a +0,124 R) | +0,139 R / -0,107 R | 714 | -0,123 R (-0,194 R a -0,052 R) | no |
| zonas FVG · margen 1 ATR · objetivo 3 R | 238 | 39,9 % | 1,03 | +0,014 R (-0,128 R a +0,157 R) | +0,188 R / -0,109 R | 713 | -0,122 R (-0,199 R a -0,045 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 1,5 R | 394 | 39,3 % | 0,70 | -0,180 R (-0,268 R a -0,092 R) | -0,211 R / -0,153 R | 1170 | -0,165 R (-0,218 R a -0,112 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 2 R | 394 | 37,6 % | 0,78 | -0,137 R (-0,236 R a -0,038 R) | -0,160 R / -0,118 R | 1165 | -0,189 R (-0,246 R a -0,132 R) | no |
| zonas OB · margen 0,25 ATR · objetivo 3 R | 393 | 36,6 % | 0,81 | -0,115 R (-0,225 R a -0,006 R) | -0,145 R / -0,090 R | 1164 | -0,197 R (-0,258 R a -0,135 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 1,5 R | 348 | 40,8 % | 0,75 | -0,142 R (-0,235 R a -0,049 R) | -0,187 R / -0,105 R | 1048 | -0,184 R (-0,239 R a -0,129 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 2 R | 348 | 39,1 % | 0,79 | -0,122 R (-0,224 R a -0,020 R) | -0,150 R / -0,098 R | 1044 | -0,214 R (-0,272 R a -0,156 R) | no |
| zonas OB · margen 0,5 ATR · objetivo 3 R | 347 | 38,0 % | 0,80 | -0,119 R (-0,229 R a -0,008 R) | -0,145 R / -0,097 R | 1043 | -0,214 R (-0,277 R a -0,151 R) | no |
| zonas OB · margen 1 ATR · objetivo 1,5 R | 233 | 46,4 % | 0,99 | -0,006 R (-0,118 R a +0,105 R) | -0,122 R / +0,094 R | 751 | -0,216 R (-0,278 R a -0,154 R) | no |
| zonas OB · margen 1 ATR · objetivo 2 R | 231 | 44,6 % | 1,01 | +0,006 R (-0,116 R a +0,128 R) | -0,130 R / +0,124 R | 750 | -0,230 R (-0,295 R a -0,164 R) | no |
| zonas OB · margen 1 ATR · objetivo 3 R | 231 | 43,3 % | 1,00 | +0,000 R (-0,132 R a +0,132 R) | -0,145 R / +0,125 R | 750 | -0,239 R (-0,308 R a -0,170 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 1,5 R | 686 | 40,1 % | 0,75 | -0,148 R (-0,216 R a -0,080 R) | -0,126 R / -0,167 R | 2096 | -0,125 R (-0,165 R a -0,085 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 2 R | 685 | 38,0 % | 0,83 | -0,099 R (-0,176 R a -0,023 R) | -0,062 R / -0,131 R | 2087 | -0,123 R (-0,167 R a -0,080 R) | no |
| zonas FVG y OB · margen 0,25 ATR · objetivo 3 R | 682 | 36,2 % | 0,86 | -0,090 R (-0,176 R a -0,005 R) | -0,021 R / -0,148 R | 2079 | -0,118 R (-0,167 R a -0,070 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 1,5 R | 610 | 42,1 % | 0,83 | -0,094 R (-0,166 R a -0,022 R) | -0,069 R / -0,115 R | 1890 | -0,138 R (-0,179 R a -0,097 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 2 R | 608 | 39,3 % | 0,85 | -0,085 R (-0,164 R a -0,005 R) | -0,043 R / -0,119 R | 1882 | -0,149 R (-0,193 R a -0,105 R) | no |
| zonas FVG y OB · margen 0,5 ATR · objetivo 3 R | 606 | 37,8 % | 0,89 | -0,068 R (-0,157 R a +0,021 R) | +0,011 R / -0,132 R | 1877 | -0,137 R (-0,186 R a -0,088 R) | no |
| zonas FVG y OB · margen 1 ATR · objetivo 1,5 R | 425 | 44,2 % | 0,93 | -0,033 R (-0,117 R a +0,052 R) | -0,013 R / -0,049 R | 1364 | -0,175 R (-0,222 R a -0,128 R) | no |
| zonas FVG y OB · margen 1 ATR · objetivo 2 R | 422 | 42,2 % | 0,96 | -0,020 R (-0,113 R a +0,073 R) | +0,006 R / -0,041 R | 1360 | -0,178 R (-0,229 R a -0,128 R) | no |
| **zonas FVG y OB · margen 1 ATR · objetivo 3 R** | 421 | 40,9 % | 1,00 | -0,001 R (-0,104 R a +0,102 R) | +0,035 R / -0,030 R | 1359 | -0,181 R (-0,235 R a -0,128 R) | no |

## 15m: fase 3, filtros de contexto (disparo BARRIDA_IFVG_BREAKER, configuración base)

| Filtro | Operaciones (desarrollo) | Acierto | Profit factor | Expectancia (IC 90 %) | Mitades del desarrollo | Operaciones (evaluación) | Expectancia (IC 90 %) | Acierto (evaluación) | PF (evaluación) |
|---|---|---|---|---|---|---|---|---|---|
| NINGUNO (el agente sin filtro) | 270 | 37,8 % | 0,77 | -0,129 R (-0,243 R a -0,014 R) | -0,108 R / -0,149 R | 832 | -0,291 R (-0,353 R a -0,229 R) | 33,2 % | 0,55 |
| PERFIL | 141 | 33,3 % | 0,74 | -0,150 R (-0,308 R a +0,009 R) | -0,141 R / -0,157 R | 425 | -0,234 R (-0,324 R a -0,143 R) | 35,8 % | 0,63 |
| SUPERTREND | 72 | 40,3 % | 0,95 | -0,027 R (-0,251 R a +0,197 R) | +0,090 R / -0,120 R | 199 | -0,214 R (-0,343 R a -0,085 R) | 38,2 % | 0,65 |
| EMAS | 33 | 36,4 % | 0,99 | -0,006 R (-0,359 R a +0,346 R) | +0,211 R / -0,115 R | 77 | -0,241 R (-0,447 R a -0,034 R) | 35,1 % | 0,61 |
| TODO | 22 | 36,4 % | 0,92 | -0,041 R (-0,460 R a +0,378 R) | +0,537 R / -0,257 R | 43 | -0,378 R (-0,649 R a -0,108 R) | 32,6 % | 0,46 |

Control (entradas al azar, mismas fechas de evaluación): -0,294 R sobre 11260 operaciones.
