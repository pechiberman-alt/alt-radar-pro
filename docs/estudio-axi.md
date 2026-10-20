# Estudio de Axi: oro y NASDAQ

Mide los mismos agentes del estudio de cripto (las mismas reglas, la misma escalera) sobre dos instrumentos de la cuenta de Axi:
oro (`XAUUSD.c`) y NASDAQ (`USTECH`). Velas de 4 h, del 14/10/2021 al 15/10/2026 (7.736 y 7.717 velas), corte 70/30 (desarrollo
hasta abril de 2025, evaluación después) y costos de 0,02 % y 0,07 % por lado.

Cómo se corre (los datos están en `datos-investigacion/`, que no se commitea):

    node --experimental-strip-types scripts/investigacion/axi-estudio.ts XAUUSDAXI
    node --experimental-strip-types scripts/investigacion/axi-estudio.ts USTECHAXI

## Resultado (15/10/2026)

- **0 agentes con ventaja** en oro ni en NASDAQ.
- **Oro**: la mejor regla es Supertrend, con 21 operaciones en el tramo de evaluación, acierto 76,2 %, profit factor 3,31, +0,560 R
  por operación, PSR 98,3 % y DSR 21,6 %. Sin conclusión: no sobrevive la corrección por las variantes miradas.
- **NASDAQ**: el control al azar queda primero a 0,02 % (+0,26 R por operación, 39 operaciones). Ninguna regla con muestra le gana.
  Las de SNR quedan con expectancia negativa y el intervalo entero bajo cero.

## Límite de los datos: el volumen

Cinco reglas miran volumen (VWAP semanal, perfil de volumen o volumen relativo): `ST_VWAP`, `ST_PERFIL`, `ST_VWAP_PERFIL`,
`ST_MTF_VOL` y `SMC_TODO`. El historial de Axi trae el volumen (`tickVolume`) en cero hasta el 15/05/2026: solo 651 velas de oro y 652
de NASDAQ tienen dato. Con eso no se pueden medir, así que el script las excluye y lo imprime.

El estudio de oro publicado antes incluía esas cinco reglas. Sus números no valen y no cuentan para ninguna conclusión. Para medirlas
hace falta un historial con volumen, o medirlas hacia adelante en papel cuando la fuente lo traiga.

## Agente Metales (METALES_D55), agregado el 2026-10-20

Ruptura de 55 velas, solo en largo, stop a 1,5 ATR, objetivo 2 R, solo oro y plata. La regla se eligió mirando el estudio de
rupturas del oro de Axi en 1 h (mismo instrumento y período), así que estos números de 4 h no son una prueba limpia. Costo de
0,07 % por lado:

| Tramo | n | Acierto | PF | R por operación | IC 90 % |
|---|---|---|---|---|---|
| Desarrollo (hasta 2025-04-14) | 105 | 41,0 % | 1,02 | +0,016 | −0,222 a +0,255 |
| Evaluación | 41 | 58,5 % | 2,28 | +0,592 | +0,214 a +0,970 |

Por año: 2021 −0,64 R (n=5), 2022 −0,26 R (n=23), 2023 −0,01 R (n=30), 2024 +0,35 R (n=30), 2025 +0,44 R (n=42), 2026 +0,40 R
(n=16). Gana cuando el oro sube en tendencia y no gana cuando no: la evaluación cae en la suba de 2025-2026. Veredicto del estudio:
SIN CONCLUSIÓN (menos de 100 operaciones y DSR de 2,6 % con todos los ensayos declarados). La plata no tiene medición. La única
prueba limpia es la de papel hacia adelante, que empieza con este agente.

## Límites

- Un solo instrumento por tabla: no hay contraste entre activos, así que una ventaja acá se apoya en menos evidencia.
- Los costos son aproximados (el spread observado en Axi, no un spread medido vela por vela).
- Muestra chica: en el tramo de evaluación hay pocas operaciones por regla. Un resultado con menos de 15 operaciones es muestra mínima.
- Es una medición del pasado. No garantiza resultados futuros y no es asesoramiento financiero.
