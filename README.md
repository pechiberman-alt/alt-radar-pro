# ALT RADAR PRO

Aplicación pública: https://alt-radar-pro.pechiberman.workers.dev

Terminal profesional de inteligencia probabilística para criptomonedas. Combina mercado Spot, amplitud de altcoins, rotación de capital, order flow, señales explicables, riesgo geopolítico y validación histórica sin mostrar datos inventados.

© 2026 URL.FX. Todos los derechos reservados.

## Funciones principales

- Universo completo de pares USDT disponibles en Binance Spot, incluidas monedas pequeñas; los filtros de liquidez impiden convertir activos ilíquidos en TRIGGER.
- Ventanas reales 1H, 4H y 24H para el universo con volumen suficiente.
- Score técnico LONG/SHORT con confirmación multi-timeframe, fortaleza relativa, estructura, volumen, liquidez y filtro anti-FOMO.
- Probabilidad de altseason con score técnico bruto, ajuste macro/geopolítico y resultado final auditable.
- Order book Spot y Futures mediante WebSocket, mapa de liquidez, footprint, cinta de operaciones, CVD, liquidaciones y batalla compradores/vendedores.
- Signal Ledger persistente en Cloudflare D1: registra SETUP/TRIGGER, captura resultados a 15m, 1H, 4H y 24H y calcula estadísticas solamente con observaciones reales.
- Modo Scalping 5M/15M separado: velas cerradas, ATR, EMA, RSI, MACD, volumen relativo, spread real, estructura, stop e invalidación obligatorios.
- Cerebro seguro con memoria walk-forward persistente y eventos encadenados por SHA-256; el chat no se guarda ni se envía a terceros.
- Analista cuantitativo local sin LLM ni consumo de tokens de API, especializado en responder sobre el snapshot real disponible.
- Consola de analista conversacional: responde por activo, señal, pumpeo, dominancia, correlaciones, riesgo y rendimiento registrado, y explica los conceptos del panel (CVD, footprint, desequilibrios, área de valor, funding, open interest, beta, R:R). Es determinista: la misma pregunta sobre el mismo snapshot devuelve siempre la misma respuesta, cada cifra sale de los paneles y las explicaciones son texto revisado, no generado. Cuando un dato falta lo declara en lugar de completarlo.
- Automatización de scalping en Cloudflare cada 5 minutos y modelo swing cada 15 minutos, además de sincronización bajo demanda.
- Alertas visuales, sonido y notificaciones del navegador con cooldown configurable.
- PWA instalable en Android, escritorio e iPhone. El panel «Descargar la terminal» detecta la plataforma y muestra los pasos que corresponden: en iOS Safari el navegador nunca ofrece el botón de instalación, así que la única vía es Compartir → Añadir a pantalla de inicio y hay que indicarla explícitamente.

## Datos y transparencia

- Binance Spot / Futures: precios, volumen, rango, ventanas móviles y order flow.
- CoinGecko Global: capitalización total y dominancia de BTC, ETH, USDT y USDC.
- CoinLore Global: respaldo de capitalización y dominancia BTC/ETH.
- GDELT News Index: noticias globales relevantes para mercados.
- Cloudflare D1: historial persistente y resultados observados.

TOTAL2 y TOTAL3 se derivan de la capitalización total y la dominancia publicada (TOTAL2 = TOTAL − BTC; TOTAL3 = TOTAL − BTC − ETH), no de una estimación. La dominancia de USDT se usa como lectura de capital al margen.

Cuando una fuente falla, la aplicación muestra `DATA UNAVAILABLE` o un estado degradado. OI y funding no se reemplazan con estimaciones cuando no existe una fuente pública fiable en el ciclo actual.

Las señales son escenarios probabilísticos, no garantías ni asesoramiento financiero. Los niveles del panel son estructuras indicativas basadas en volatilidad observada; la aplicación no ejecuta operaciones.

## Ejecutar localmente

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

Para validar:

```bash
npm run lint
npm test
```

## Persistencia y automatización

El esquema está en `db/schema.ts` y las migraciones en `drizzle/`. La configuración lógica de Sites declara el binding `DB`; la configuración de producción enlaza la base D1 y activa los ciclos automáticos de 5 y 15 minutos.

La infraestructura está diseñada para funcionar dentro de los límites gratuitos de Cloudflare Workers y D1. En el plan gratuito, al alcanzar un límite el servicio se detiene temporalmente en vez de generar cargos; conviene vigilar el uso desde el panel de Cloudflare.

## Despliegue continuo

El workflow de GitHub valida, aplica migraciones y publica en Cloudflare cuando se actualiza `main`. Requiere `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en los secretos del repositorio.
