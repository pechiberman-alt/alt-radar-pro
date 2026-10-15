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

## Límites

- Un solo instrumento por tabla: no hay contraste entre activos, así que una ventaja acá se apoya en menos evidencia.
- Los costos son aproximados (el spread observado en Axi, no un spread medido vela por vela).
- Muestra chica: en el tramo de evaluación hay pocas operaciones por regla. Un resultado con menos de 15 operaciones es muestra mínima.
- Es una medición del pasado. No garantiza resultados futuros y no es asesoramiento financiero.
