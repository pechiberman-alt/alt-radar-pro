import assert from "node:assert/strict";
import test from "node:test";
import { CMC_STABLE_IDS, parseCmcGlobal } from "../lib/market-structure.ts";

const global = {
  status: { error_code: 0 },
  data: {
    btc_dominance: 58.4,
    eth_dominance: 12.1,
    quote: { USD: { total_market_cap: 3_900_000_000_000, total_volume_24h: 140_000_000_000, total_market_cap_yesterday_percentage_change: -1.25 } },
  },
};
const stables = {
  data: {
    [CMC_STABLE_IDS.usdt]: { quote: { USD: { market_cap: 175_500_000_000 } } },
    [CMC_STABLE_IDS.usdc]: [{ quote: { USD: { market_cap: 74_100_000_000 } } }],
  },
};

test("CoinMarketCap: dominance, totals and the stablecoin shares from the server", () => {
  const s = parseCmcGlobal(global, stables)!;
  assert.equal(s.source, "CoinMarketCap");
  assert.equal(s.totalMarketCap, 3_900_000_000_000);
  assert.equal(s.dominance.btc, 58.4);
  assert.equal(s.marketCapChange24h, -1.25);
  assert.equal(s.dominance.usdt!.toFixed(3), "4.500");
  assert.equal(s.dominance.usdc!.toFixed(2), "1.90");
  assert.equal(s.dominance.stablecoins!.toFixed(2), "6.40");
  assert.ok(s.total2 !== null && s.total2 < s.totalMarketCap);
});

test("CoinMarketCap: a missing stablecoin answer is unknown, never zero; a broken answer is no reading", () => {
  const noStables = parseCmcGlobal(global, null)!;
  assert.equal(noStables.dominance.usdt, null);
  assert.equal(noStables.dominance.stablecoins, null);
  const oneMissing = parseCmcGlobal(global, { data: { [CMC_STABLE_IDS.usdt]: stables.data[CMC_STABLE_IDS.usdt] } })!;
  assert.ok(oneMissing.dominance.usdt !== null);
  assert.equal(oneMissing.dominance.stablecoins, null, "USDC unknown: the sum is unknown");
  assert.equal(parseCmcGlobal({ status: { error_code: 1001 } }), null);
  assert.equal(parseCmcGlobal({ data: { quote: { USD: { total_market_cap: 0 } } } }), null);
  assert.equal(parseCmcGlobal("<html>"), null);
});
