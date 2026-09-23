const http = require('http');

const PORT = process.env.PORT || 10000;
const CONTRACT = '0x22fd16577ba869A7df77F4280ae08c65BB03111d';
const PAIR = '0x0ebdefc82e75748e1699a4b79f1f6e3f975deb3f92feed77ca0d4a3df68c3f04';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let marketCache = { data: null, expiresAt: 0 };
let contractDeploymentBlockCache = null;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function rpcCall(method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://rpc.mainnet.chain.robinhood.com', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SUNV-Holder-Hub/1.0'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Robinhood RPC HTTP ' + response.status);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'Robinhood RPC error');
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
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
  if (marketCache.data && Date.now() < marketCache.expiresAt) {
    return json(res, 200, marketCache.data);
  }

  let market;
  let primaryError = null;
  try {
    market = await marketFromDexScreener();
  } catch (error) {
    primaryError = error.message;
    market = await marketFromGeckoTerminal();
  }

  const payload = {
    ...market,
    fetchedAt: new Date().toISOString()
  };
  marketCache = { data: payload, expiresAt: Date.now() + 60000 };

  console.log('[MARKET]', market.source, JSON.stringify({
    priceUsd: market.priceUsd,
    liquidityUsd: market.liquidityUsd,
    volume24: market.volume24,
    buys24: market.buys24,
    sells24: market.sells24,
    fallbackReason: primaryError
  }));

  json(res, 200, payload);
}

async function handleHolders(res) {
  try {
    const tokenUrl = 'https://robinhoodchain.blockscout.com/api/v2/tokens/' + CONTRACT;
    const token = await fetchJson(tokenUrl);

    let count = Number(
      token?.holders_count ??
      token?.holders ??
      token?.holder_count
    );

    if (!Number.isFinite(count)) {
      const holdersUrl = 'https://robinhoodchain.blockscout.com/api/v2/tokens/' + CONTRACT + '/holders';
      const holders = await fetchJson(holdersUrl);
      if (!holders || !Array.isArray(holders.items)) {
        throw new Error('Blockscout v2 holder data unavailable');
      }
      count = holders.items.length;
    }

    console.log('[HOLDERS]', count);
    return json(res, 200, {
      source: 'Robinhood Chain Blockscout v2',
      fetchedAt: new Date().toISOString(),
      live: true,
      count,
      capped: false
    });
  } catch (error) {
    console.warn('[HOLDERS] live API unavailable:', error.message);
    return json(res, 200, {
      source: 'SUNV verified snapshot',
      fetchedAt: new Date().toISOString(),
      live: false,
      lastVerifiedCount: 4,
      lastVerifiedAt: '2026-09-21',
      note: 'Blockscout currently rejects server-side API requests for this token. Use the direct Blockscout link for the current live count.'
    });
  }
}


function topicAddress(address) {
  return '0x' + address.slice(2).toLowerCase().padStart(64, '0');
}

function addressFromTopic(topic) {
  if (typeof topic !== 'string' || topic.length < 42) return null;
  return '0x' + topic.slice(-40);
}

function sunvFromHex(hex) {
  const raw = BigInt(hex || '0x0');
  const whole = raw / 1000000000000000000n;
  const fraction = raw % 1000000000000000000n;
  const fractionText = fraction.toString().padStart(18, '0').replace(/0+$/, '');
  return fractionText ? whole.toString() + '.' + fractionText : whole.toString();
}

async function getWalletTransferLogsInRange(address, fromBlock, toBlock) {
  const addressTopic = topicAddress(address);
  const base = {
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16),
    address: CONTRACT
  };

  const [outgoing, incoming] = await Promise.all([
    rpcCall('eth_getLogs', [{ ...base, topics: [TRANSFER_TOPIC, addressTopic] }]),
    rpcCall('eth_getLogs', [{ ...base, topics: [TRANSFER_TOPIC, null, addressTopic] }])
  ]);

  const combined = [...(Array.isArray(outgoing) ? outgoing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const seen = new Set();
  return combined.filter((log) => {
    const key = String(log.transactionHash || '') + ':' + String(log.logIndex || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getContractDeploymentBlock(latestBlock) {
  if (Number.isFinite(contractDeploymentBlockCache)) return contractDeploymentBlockCache;

  let low = 0;
  let high = latestBlock;
  let firstWithCode = latestBlock;

  try {
    const latestCode = await rpcCall('eth_getCode', [CONTRACT, 'latest']);
    if (!latestCode || latestCode === '0x') {
      throw new Error('SUNV contract code is unavailable at latest block');
    }

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const blockTag = '0x' + mid.toString(16);
      const code = await rpcCall('eth_getCode', [CONTRACT, blockTag]);

      if (code && code !== '0x') {
        firstWithCode = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    contractDeploymentBlockCache = firstWithCode;
    console.log('[ACTIVITY] detected contract deployment block', firstWithCode);
    return firstWithCode;
  } catch (error) {
    const fallback = Math.max(0, latestBlock - 5000000);
    console.warn('[ACTIVITY] deployment block detection failed, using fallback', error.message);
    return fallback;
  }
}

async function transferLogsForAddress(address) {
  const latestHex = await rpcCall('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  if (!Number.isFinite(latest)) throw new Error('Unable to read latest Robinhood Chain block');

  const earliest = await getContractDeploymentBlock(latest);
  const matched = [];
  let end = latest;
  let successfulRanges = 0;
  let fullyScanned = true;
  const maxEvents = 1000;

  while (end >= earliest) {
    let chunkSize = 100000;
    let logs = null;
    let start = Math.max(earliest, end - chunkSize + 1);

    while (chunkSize >= 2500 && logs === null) {
      start = Math.max(earliest, end - chunkSize + 1);
      try {
        logs = await getWalletTransferLogsInRange(address, start, end);
      } catch (error) {
        console.warn('[ACTIVITY] wallet-filtered log range failed', start, end, error.message);
        chunkSize = Math.floor(chunkSize / 2);
      }
    }

    if (logs === null) {
      fullyScanned = false;
      end = start - 1;
      continue;
    }

    successfulRanges += 1;
    matched.push(...logs);

    if (matched.length >= maxEvents) {
      fullyScanned = false;
      break;
    }

    end = start - 1;
  }

  if (successfulRanges === 0) {
    throw new Error('Robinhood Chain log provider did not return a readable transfer range');
  }

  const sorted = matched
    .sort((a, b) => {
      const blockDiff = parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16);
      if (blockDiff !== 0) return blockDiff;
      return parseInt(a.logIndex || '0x0', 16) - parseInt(b.logIndex || '0x0', 16);
    })
    .slice(0, maxEvents);

  return {
    latestBlock: latest,
    earliestBlock: earliest,
    fullyScanned,
    logs: sorted
  };
}
async function handleActivity(req, res) {
  const body = await readJsonBody(req);
  const address = String(body?.address || '').trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return json(res, 400, { error: 'Invalid EVM wallet address' });
  }

  const scan = await transferLogsForAddress(address);
  const allLogs = scan.logs;
  const displayLogs = allLogs.slice(-20).reverse();

  const timestampBlocks = new Set(displayLogs.map((log) => log.blockNumber));
  if (allLogs.length) {
    timestampBlocks.add(allLogs[0].blockNumber);
    timestampBlocks.add(allLogs[allLogs.length - 1].blockNumber);
  }

  const blockPairs = await Promise.all([...timestampBlocks].map(async (blockNumber) => {
    try {
      const block = await rpcCall('eth_getBlockByNumber', [blockNumber, false]);
      return [blockNumber, block?.timestamp ? parseInt(block.timestamp, 16) * 1000 : null];
    } catch {
      return [blockNumber, null];
    }
  }));
  const timestamps = Object.fromEntries(blockPairs);
  const wanted = address.toLowerCase();

  function decodeTransfer(log) {
    const from = addressFromTopic(log?.topics?.[1]);
    const to = addressFromTopic(log?.topics?.[2]);
    const fromLower = from?.toLowerCase();
    const toLower = to?.toLowerCase();

    let direction = 'TRANSFER';
    let counterparty = null;
    if (fromLower === wanted && toLower === wanted) {
      direction = 'SELF';
      counterparty = address;
    } else if (toLower === wanted) {
      direction = 'IN';
      counterparty = from;
    } else if (fromLower === wanted) {
      direction = 'OUT';
      counterparty = to;
    }

    return {
      direction,
      amountSunv: sunvFromHex(log.data),
      from,
      to,
      counterparty,
      txHash: log.transactionHash,
      blockNumber: parseInt(log.blockNumber, 16),
      timestamp: timestamps[log.blockNumber] ?? null,
      logIndex: log.logIndex ? parseInt(log.logIndex, 16) : null
    };
  }

  const allTransfers = allLogs.map(decodeTransfer);
  const transfers = displayLogs.map(decodeTransfer);

  let receivedRaw = 0n;
  let sentRaw = 0n;
  const counterparties = new Set();

  for (let i = 0; i < allTransfers.length; i += 1) {
    const transfer = allTransfers[i];
    const rawAmount = BigInt(allLogs[i]?.data || '0x0');
    if (transfer.direction === 'IN') receivedRaw += rawAmount;
    if (transfer.direction === 'OUT') sentRaw += rawAmount;
    if (transfer.counterparty && transfer.direction !== 'SELF') {
      counterparties.add(transfer.counterparty.toLowerCase());
    }
  }

  const firstLog = allLogs[0] || null;
  const lastLog = allLogs[allLogs.length - 1] || null;
  const receivedSunv = sunvFromHex('0x' + receivedRaw.toString(16));
  const sentSunv = sunvFromHex('0x' + sentRaw.toString(16));
  const netRaw = receivedRaw - sentRaw;
  const netNegative = netRaw < 0n;
  const netAbs = netNegative ? -netRaw : netRaw;
  const netSunv = (netNegative ? '-' : '') + sunvFromHex('0x' + netAbs.toString(16));

  console.log('[ACTIVITY] address transfer count', allTransfers.length, 'fullyScanned', scan.fullyScanned);
  return json(res, 200, {
    source: 'Robinhood Chain public RPC',
    fetchedAt: new Date().toISOString(),
    address,
    scannedFromBlock: scan.earliestBlock,
    scannedToBlock: scan.latestBlock,
    coverage: scan.fullyScanned ? 'contract-lifetime' : 'partial',
    transfers,
    analytics: {
      transferEvents: allTransfers.length,
      incomingEvents: allTransfers.filter((t) => t.direction === 'IN').length,
      outgoingEvents: allTransfers.filter((t) => t.direction === 'OUT').length,
      totalReceivedSunv: receivedSunv,
      totalSentSunv: sentSunv,
      netFlowSunv: netSunv,
      uniqueCounterparties: counterparties.size,
      firstActivityAt: firstLog ? (timestamps[firstLog.blockNumber] ?? null) : null,
      mostRecentActivityAt: lastLog ? (timestamps[lastLog.blockNumber] ?? null) : null,
      fullyScanned: scan.fullyScanned
    }
  });
}
async function handleBalance(req, res) {
  const body = await readJsonBody(req);
  const address = String(body?.address || '').trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return json(res, 400, { error: 'Invalid EVM wallet address' });
  }

  const addressWord = address.slice(2).toLowerCase().padStart(64, '0');
  const data = '0x70a08231' + addressWord;
  const rawHex = await rpcCall('eth_call', [{ to: CONTRACT, data }, 'latest']);

  if (typeof rawHex !== 'string' || !rawHex.startsWith('0x')) {
    throw new Error('Unexpected balance response from Robinhood Chain');
  }

  const raw = BigInt(rawHex);
  const whole = raw / 1000000000000000000n;
  const fraction = raw % 1000000000000000000n;
  const fractionText = fraction.toString().padStart(18, '0').replace(/0+$/, '');
  const balanceSunv = fractionText ? whole.toString() + '.' + fractionText : whole.toString();

  console.log('[BALANCE] read-only lookup completed');
  return json(res, 200, {
    source: 'Robinhood Chain public RPC',
    fetchedAt: new Date().toISOString(),
    address,
    contract: CONTRACT,
    balanceRaw: raw.toString(),
    balanceSunv
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
        version: '1.3',
        time: new Date().toISOString()
      });
    }

    if (req.method === 'POST' && req.url === '/api/balance') {
      return await handleBalance(req, res);
    }

    if (req.method === 'POST' && req.url === '/api/activity') {
      return await handleActivity(req, res);
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
  console.log('SUNV data proxy v1.3 listening on port ' + PORT);
});