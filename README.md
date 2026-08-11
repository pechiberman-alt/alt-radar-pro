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
- Automatización en Cloudflare cada 15 minutos, además de sincronización bajo demanda desde la interfaz.
- Alertas visuales, sonido y notificaciones del navegador con cooldown configurable.
- PWA instalable en Android y escritorio.

## Datos y transparencia

- Binance Spot / Futures: precios, volumen, rango, ventanas móviles y order flow.
- CoinLore Global: dominancia de BTC como respaldo público.
- GDELT News Index: noticias globales relevantes para mercados.
- Cloudflare D1: historial persistente y resultados observados.

Cuando una fuente falla, la aplicación muestra `DATA UNAVAILABLE` o un estado degradado. OI, funding, TOTAL2 y TOTAL3 no se reemplazan con estimaciones cuando no existe una fuente pública fiable en el ciclo actual.

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

El esquema está en `db/schema.ts` y las migraciones en `drizzle/`. La configuración lógica de Sites declara el binding `DB`; la configuración de producción enlaza la base D1 y activa el cron cada 15 minutos.

La infraestructura está diseñada para funcionar dentro de los límites gratuitos de Cloudflare Workers y D1. En el plan gratuito, al alcanzar un límite el servicio se detiene temporalmente en vez de generar cargos; conviene vigilar el uso desde el panel de Cloudflare.

## Despliegue continuo

El workflow de GitHub valida, aplica migraciones y publica en Cloudflare cuando se actualiza `main`. Requiere `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en los secretos del repositorio.
