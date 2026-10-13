# Investigación de la mesa

Herramientas para **medir** las reglas de la mesa de JARVIS (`lib/jarvis-desk.ts`) sobre velas pasadas, con otras velas base y con modelos que intentan aprender. No corren en la app ni la tocan: la app solo cambia cuando una medición hecha acá lo justifica y se documenta (regla del objetivo «jarvis» en `docs/araña/objetivos.md`: cambiar una regla exige medirla en los tres períodos, con costos más altos, y decir lo que no mejoró).

Todo es una medición del pasado: **no garantiza rentabilidad futura y no es asesoramiento financiero.**

Resultados y lectura:

- `docs/mesa-reglas-v2.md`: qué cambió en v2 y cómo se midió.
- `docs/mesa-perfiles.md`: la mesa con velas de 15 min, 2 h, 4 h, 6 h y 12 h.
- `docs/mesa-aprendizaje.md`: si un modelo puede aprender de las operaciones pasadas (no pudo, con la prueba que se hizo).

## Cómo reproducirlo

Hace falta Node 22+ (los scripts son TypeScript sin compilar) y, para bajar las velas, Python 3 con `pyarrow` y salida a `github.com`.

```bash
# 1. Velas de Binance (repositorio público Speirsy11/crypto-dataset), 10 monedas. Deja SIMBOLO-INTERVALO.json en datos-investigacion/
pip install pyarrow
python3 scripts/investigacion/datos.py                       # o: datos.py <carpeta> --monedas BTCUSDT ETHUSDT --hasta 2026-09

# 2. Lo que la mesa veía en cada cierre de 4 velas base (solo velas cerradas). Tarda ~7 ms por lectura: unos 80 s por moneda con 1 h
node --experimental-strip-types scripts/investigacion/precalcular.ts 1h 2021-01-01 2026-09-30
node --experimental-strip-types scripts/investigacion/precalcular.ts 15m 2024-02-15 2026-09-30   # el dataset de 15 min empieza en 2024-01

# 3. Medir
node --experimental-strip-types scripts/investigacion/medir.ts 1h                # v1 contra v2 en los tres períodos y los últimos 180 días
node --experimental-strip-types scripts/investigacion/medir.ts 1h --costos       # comisión + deslizamiento de 0,05% a 0,15% por lado
node --experimental-strip-types scripts/investigacion/medir.ts 1h --densa        # todos los puntos de decisión, no una operación a la vez
node --experimental-strip-types scripts/investigacion/medir.ts 1h --detalle      # por lado, año, moneda y tipo de salida
node --experimental-strip-types scripts/investigacion/medir.ts 1h --variantes    # cambios a las reglas v2 que se probaron y no se adoptaron
node --experimental-strip-types scripts/investigacion/medir.ts 1h --real BTCUSDT # valida el simulador contra el backtest real de la app
node --experimental-strip-types scripts/investigacion/perfiles.ts                # tabla de velas base (docs/mesa-perfiles.md)
node --experimental-strip-types scripts/investigacion/perfiles.ts --intervalos   # con intervalos del 90% (semanas remuestreadas) y diferencias entre perfiles
node --experimental-strip-types scripts/investigacion/aprendizaje.ts             # modelos hacia adelante (docs/mesa-aprendizaje.md)
node --experimental-strip-types scripts/investigacion/aprendizaje.ts --cortes    # cortes por consenso, stop, TP1, régimen, lado, tendencia
```

Las carpetas `datos-investigacion/` y `salida-investigacion/` no se commitean (están en `.gitignore`). Se cambian con las variables `ALT_RADAR_DATOS` y `ALT_RADAR_SALIDA`. `COMISION_PCT` (por defecto 0,05) cambia la comisión por lado del simulador.

## Qué hace cada archivo

| Archivo | Para qué |
| --- | --- |
| `datos.py` | Baja las velas mensuales (Parquet) y las junta en `SIMBOLO-INTERVALO.json`. |
| `util.ts` | Monedas, perfiles de velas base y el «tiempo virtual» (ver abajo). |
| `precalcular.ts` | Corre los especialistas de la app en cada cierre y guarda lo que veían (`lecturas-<perfil>-<moneda>.json`). |
| `simulador.ts` | Reproduce las decisiones de la mesa y las reglas del papel sobre esas lecturas, en segundos. Reglas `V1` (anteriores) y `V2` (las de la app). También `intervaloPorSemanas`: intervalo del 90% remuestreando semanas enteras. |
| `medir.ts` | Tablas por período, sensibilidad al costo, muestra densa, detalle y validación contra el backtest real. |
| `perfiles.ts` | La mesa con 15 min, 1 h, 2 h, 4 h, 6 h y 12 h como vela base; con `--intervalos`, los intervalos del 90% y las diferencias entre perfiles y entre reglas. |
| `modelos.ts` | Regresión ridge, regresión logística y árboles potenciados chicos, sin dependencias, y AUC. |
| `aprendizaje.ts` | Arma un punto por decisión y entrena «hacia adelante»: cada trimestre solo con operaciones ya resueltas. |

Los tests están en `tests/investigacion.test.ts`.

## Tiempo virtual (otras velas base)

El motor de la mesa está escrito para velas de 1 h, 4 h y 1 d (relación 1:4:24). Para probar otra vela base se le dan esas velas con el tiempo reescalado, de modo que una vela base valga «una hora» del motor, y las velas medias y altas se arman agrupando 4 y 24 velas base, igual que la app arma las de 4 h y 1 d con las de 1 h. El motor es el mismo, sin tocar. El horizonte (168 velas base), el vencimiento de la orden límite (48) y la cadencia de decisión (cada 4 velas base) escalan solos. Con 15 min los marcos del motor son 15 min / 1 h / 6 h; con 6 h, 6 h / 1 d / 6 d.

## Reglas que no se rompen

- **Nada de mirar el futuro.** Cada lectura usa solo velas cerradas (test: deformar lo que viene después del corte no cambia ninguna lectura anterior). Cada modelo se entrena solo con operaciones ya resueltas antes de la fecha que predice.
- **Peor caso primero.** Si una vela toca el stop y el objetivo, cuenta el stop. Si la vela que cobra el TP1 también vuelve a la entrada, el resto sale en la entrada.
- **Una operación a la vez** por moneda en las tablas por período. La muestra densa (`--densa`) cuenta todos los puntos de decisión y se solapan en el tiempo: no son independientes.
- **El aprendizaje no cambia las reglas.** Los modelos de acá solo miden. Ningún modelo ni probabilidad de esta carpeta llega a la app.
- **Si cambia el motor, volvé a validar** con `medir.ts 1h --real BTCUSDT`. El simulador tiene que decidir como la mesa real: por ejemplo, la orden límite se prueba solo si a mercado el R:R no llega al mínimo (`bestPlan` en `lib/jarvis-desk.ts`); una versión anterior la tomaba también cuando frenaba otro veto, y daba operaciones que la app nunca toma.

## Límites de lo medido

- 10 monedas grandes de hoy (hay sesgo de supervivencia) y velas de Binance. Sin deslizamiento ni financiamiento de futuros, con ejecución perfecta al precio del plan (el costo por lado se puede subir con `--costos`).
- Sin derivados, noticias ni calendario históricos: esos especialistas pesan cero. En vivo sí leen, así que lo medido no es exactamente lo que ve la persona.
- Se probaron varios cientos de combinaciones de reglas mirando los mismos períodos: los números elegidos son optimistas por esa selección.
- Las posiciones de las 10 monedas están muy correlacionadas (en promedio abiertas 6 o 7 de 10 a la vez): diez monedas no son diez pruebas independientes.
