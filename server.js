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
  res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=20');
  res.end(JSON.stringify(body));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SUNV-Transparency-Dashboard/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Upstream HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMarket(res) {
  const url = 'https://api.dexscreener.com/latest/dex/pairs/robinhood/' + PAIR;
  const data = await fetchJson(url);
  const pair = data && Array.isArray(data.pairs) ? data.pairs[0] : null;
  if (!pair) throw new Error('SUNV pair not returned');

  json(res, 200, {
    source: 'DEX Screener',
    fetchedAt: new Date().toISOString(),
    priceUsd: pair.priceUsd ?? null,
    priceNative: pair.priceNative ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    volume24: pair.volume?.h24 ?? null,
    priceChange24: pair.priceChange?.h24 ?? null,
    fdv: pair.fdv ?? null,
    marketCap: pair.marketCap ?? null,
    buys24: pair.txns?.h24?.buys ?? 0,
    sells24: pair.txns?.h24?.sells ?? 0,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? PAIR
  });
}

async function handleHolders(res) {
  const url =
    'https://robinhoodchain.blockscout.com/api?module=token&action=getTokenHolders&contractaddress=' +
    CONTRACT +
    '&page=1&offset=1000';
  const data = await fetchJson(url);

  if (!data || !Array.isArray(data.result)) {
    throw new Error('Blockscout holder list unavailable');
  }

  json(res, 200, {
    source: 'Robinhood Chain Blockscout',
    fetchedAt: new Date().toISOString(),
    count: data.result.length,
    capped: data.result.length >= 1000
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.url === '/' || req.url === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'SUNV public data proxy',
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
    return json(res, 502, {
      error: 'Upstream data unavailable',
      detail: error && error.message ? error.message : 'Unknown error'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('SUNV data proxy listening on port ' + PORT);
});
