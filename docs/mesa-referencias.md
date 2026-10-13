# Referencias de GitHub para la mesa y la araña

Qué proyectos abiertos se miraron para la mesa y la araña, con qué licencia y qué se tomó. Verificado el 13/10/2026 leyendo cada licencia y, donde se dice, el README o el código del repositorio. No se copió código de ninguno: lo que se toma son ideas y pruebas que se rehacen acá.

## Qué se miró

| Proyecto | Licencia (verificada) | Qué se miró | Qué se tomó |
|---|---|---|---|
| ranaroussi/quantstats | Apache 2.0 (LICENSE.txt) | Sus funciones de métricas: `win_rate`, `payoff_ratio`, `profit_factor`, `expected_return`, `sharpe`, `sortino`, `max_drawdown`, `kelly_criterion` | La lista de métricas que la araña explica. Las fórmulas están hechas de nuevo en `lib/jarvis-stats.ts` y se comparan con scipy en `tests/jarvis-stats.test.ts`. |
| freqtrade/freqtrade | GPL-3.0 (LICENSE) | El README: los comandos `lookahead-analysis` (sesgo de anticipación, que una regla use velas futuras) y `recursive-analysis` (fórmulas recursivas) | La idea de comprobar que no se mira el futuro. Ya es una prueba del proyecto («no se mira el futuro»). No se copió código: la GPL-3.0 obliga a licenciar como GPL cualquier versión modificada. |
| microsoft/qlib | MIT (LICENSE) | Solo la licencia | Nada por ahora. Queda como idea posible: evaluar «caminando hacia adelante» (walk-forward). No está implementada. |
| polakowo/vectorbt | Apache 2.0 con Commons Clause (LICENSE.md) | Solo la licencia | Nada por ahora. La Commons Clause prohíbe vender software cuyo valor depende sustancialmente de vectorbt: cualquier uso comercial derivado necesita revisión legal. La búsqueda de reglas entre muchas variantes ya se mide con la probabilidad de sobreajuste (PBO) de `lib/jarvis-stats.ts`. |

## Cómo entra en el software

- Son estudios, no dependencias. La app corre en el Worker (JavaScript) y estos proyectos son de Python: no entran en producción ni se agregó ningún paquete.
- Las medidas que muestra la mesa (intervalos de Wilson, bootstrap en bloques, PSR, DSR, PBO) salen de los papers citados en `lib/jarvis-stats.ts` y de una implementación propia, validada contra scipy 1.18.1.
- Ruflo (los agentes de desarrollo, `.mcp.json`) sirve para estudiar estrategias fuera de la app. Lo que sale de ahí entra solo por un cambio revisado y medido en los tres períodos (`docs/mesa-aprendizaje.md`). La app no se reentrena ni cambia sus reglas mientras corre.
- No se conectó ningún repositorio externo al software de producción, ni se usaron claves ni datos de usuarios.

## Lo que no se hizo

- De qlib y de vectorbt se leyó la licencia, no el código.
- Ninguna referencia está medida dentro de la mesa: cualquier idea que se quiera probar sale de un PR con la medición en `docs/mesa-reglas-v2.md`, igual que los cambios de reglas.
- Esto describe cómo se estudió. No es asesoramiento financiero ni garantiza que una técnica gane.
