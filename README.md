# ALT RADAR PRO

Aplicación pública: https://alt-radar-pro.pechiberman.workers.dev

Institutional-style crypto market intelligence dashboard. It combines public market data, altseason breadth, capital rotation, explainable pre-pump scoring, a risk engine, and global geopolitical news into an auditable decision layer.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Production validation uses `npm run build`.

## Live data

- Binance Spot: prices, 24h volume/range and hourly candles.
- CoinGecko Global: BTC market dominance.
- GDELT News Index: current market-relevant global headlines.

Every provider is isolated behind the `/api/radar` aggregation route. Provider failures return an explicit unavailable state; the UI never substitutes fictional values. The current release uses public endpoints and does not require API keys.

## Decision model

`lib/radar.ts` contains pure, auditable functions for altseason scoring, geopolitical risk, capital rotation, and asset ranking. Raw technical score, news/macro adjustment, penalties, and final score remain separate. A trigger needs score and independent confirmations; extended moves and the geopolitical kill switch block entries.

Risk levels shown in the signal drawer are indicative structures derived from observed 24h range. This is market intelligence software, not order execution or financial advice.

## Despliegue continuo

El workflow `.github/workflows/deploy-cloudflare.yml` valida y publica los cambios de `main` en Cloudflare Workers. Requiere los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` configurados en GitHub Actions.
