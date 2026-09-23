const http = require('http');

const PORT = process.env.PORT || 10000;
const CONTRACT = '0x22fd16577ba869A7df77F4280ae08c65BB03111d';
const PAIR = '0x0ebdefc82e75748e1699a4b79f1f6e3f975deb3f92feed77ca0d4a3df68c3f04';

const allowedOrigins = new Set([
  'https://sunvcoin.com',
  'https://www.sunvcoin.com',
  'https://sunv-official.onrender.com'
]);

function cors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SUNV-Transparency-Dashboard/1.1'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Upstream HTTP ' + response.status + ' for ' + url);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function chooseSunvPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const exact = pairs.find((p) => String(p.pairAddress || '').toLowerCase() === PAIR.toLowerCase());
  if (exact) return exact;
  const usdg = pairs.find((p) => {
    const base = String(p.baseToken?.address || '').toLowerCase();
    const baseSymbol = String(p.baseToken?.symbol || '').toUpperCase();
    const quoteSymbol = String(p.quoteToken?.symbol || '').toUpperCase();
    return base === CONTRACT.toLowerCase() && baseSymbol === 'SUNV' && quoteSymbol === 'USDG';
  });
  return usdg || pairs[0];
}

async function marketFromDexScreener() {
  // Token-pairs endpoint is more reliable for Uniswap v4 pool IDs than pair lookup.
  const tokenPairsUrl = 'https://api.dexscreener.com/token-pairs/v1/robinhood/' + CONTRACT;
  const pairs = await fetchJson(tokenPairsUrl);
  const pair = chooseSunvPair(pairs);
  if (!pair) throw new Error('DEX Screener returned no SUNV pools');

  return {
    source: 'DEX Screener',
    priceUsd: pair.priceUsd ?? null,
    priceNative: pair.priceNative ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    volume24: pair.volume?.h24 ?? null,
    priceChange24: pair.priceChange?.h24 ?? null,
    fdv: pair.fdv ?? null,
    marketCap: pair.marketCap ?? null,
    buys24: pair.txns?.h24?.buys ?? null,
    sells24: pair.txns?.h24?.sells ?? null,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? PAIR
  };
}

async function marketFromGeckoTerminal() {
  const url = 'https://api.geckoterminal.com/api/v2/networks/robinhood/pools/' + PAIR;
  const payload = await fetchJson(url);
  const a = payload?.data?.attributes;
  if (!a) throw new Error('GeckoTerminal returned no SUNV pool');

  const createdMs = a.pool_created_at ? Date.parse(a.pool_created_at) : null;
  return {
    source: 'GeckoTerminal',
    priceUsd: a.base_token_price_usd ?? null,
    priceNative: a.base_token_price_quote_token ?? null,
    liquidityUsd: a.reserve_in_usd ?? null,
    volume24: a.volume_usd?.h24 ?? null,
    priceChange24: a.price_change_percentage?.h24 ?? null,
    fdv: a.fdv_usd ?? null,
    marketCap: a.market_cap_usd ?? null,
    buys24: a.transactions?.h24?.buys ?? null,
    sells24: a.transactions?.h24?.sells ?? null,
    pairCreatedAt: Number.isFinite(createdMs) ? createdMs : null,
    dexId: payload?.data?.relationships?.dex?.data?.id ?? null,
    pairAddress: PAIR
  };
}

async function handleMarket(res) {
  let market;
  let primaryError = null;
  try {
    market = await marketFromDexScreener();
  } catch (error) {
    primaryError = error.message;
    market = await marketFromGeckoTerminal();
  }

  console.log('[MARKET]', market.source, JSON.stringify({
    priceUsd: market.priceUsd,
    liquidityUsd: market.liquidityUsd,
    volume24: market.volume24,
    buys24: market.buys24,
    sells24: market.sells24,
    fallbackReason: primaryError
  }));

  json(res, 200, {
    ...market,
    fetchedAt: new Date().toISOString()
  });
}

async function handleHolders(res) {
  // Prefer Blockscout's current v2 API. The legacy Etherscan-style endpoint
  // can return 403 on Robinhood Chain even though the public explorer works.
  const tokenUrl = 'https://robinhoodchain.blockscout.com/api/v2/tokens/' + CONTRACT;
  const token = await fetchJson(tokenUrl);

  let count = Number(
    token?.holders_count ??
    token?.holders ??
    token?.holder_count
  );

  // Some Blockscout versions omit holders_count from token details.
  // For small/new tokens, count the public holder list as a fallback.
  if (!Number.isFinite(count)) {
    const holdersUrl = 'https://robinhoodchain.blockscout.com/api/v2/tokens/' + CONTRACT + '/holders';
    const holders = await fetchJson(holdersUrl);
    if (!holders || !Array.isArray(holders.items)) {
      throw new Error('Blockscout v2 holder data unavailable');
    }
    count = holders.items.length;
  }

  console.log('[HOLDERS]', count);
  json(res, 200, {
    source: 'Robinhood Chain Blockscout v2',
    fetchedAt: new Date().toISOString(),
    count,
    capped: false
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  console.log('[REQUEST]', req.method, req.url, req.headers.origin || 'no-origin');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.url === '/' || req.url === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'SUNV public data proxy',
        version: '1.1',
        time: new Date().toISOString()
      });
    }

    if (req.method !== 'GET') {
      return json(res, 405, { error: 'Method not allowed' });
    }

    if (req.url === '/api/market') return await handleMarket(res);
    if (req.url === '/api/holders') return await handleHolders(res);

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[ERROR]', req.url, error && error.stack ? error.stack : error);
    return json(res, 502, {
      error: 'Upstream data unavailable',
      detail: error && error.message ? error.message : 'Unknown error'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('SUNV data proxy v1.1 listening on port ' + PORT);
});