const SUNV = {
  contract: '0x22fd16577ba869A7df77F4280ae08c65BB03111d',
  pair: '0x0ebdefc82e75748e1699a4b79f1f6e3f975deb3f92feed77ca0d4a3df68c3f04',
  chain: 'robinhood'
};

const dexUrl = `https://api.dexscreener.com/latest/dex/pairs/${SUNV.chain}/${SUNV.pair}`;
const holdersUrl = `https://robinhoodchain.blockscout.com/api?module=token&action=getTokenHolders&contractaddress=${SUNV.contract}&page=1&offset=1000`;

const $field = (name) => document.querySelectorAll(`[data-field="${name}"]`);
const setField = (name, value) => $field(name).forEach((el) => { el.textContent = value; });

function money(value, maxDecimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) < 0.01 && number !== 0) {
    return '$' + number.toLocaleString(undefined, { maximumSignificantDigits: 5 });
  }
  return '$' + number.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals
  });
}

function compactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return '$' + Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(number);
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatAge(timestampMs) {
  if (!timestampMs) return '—';
  const diff = Math.max(0, Date.now() - Number(timestampMs));
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function styleChange(value) {
  const nodes = $field('change24');
  const n = Number(value);
  nodes.forEach((node) => {
    node.classList.remove('metric-positive', 'metric-negative');
    if (Number.isFinite(n)) node.classList.add(n >= 0 ? 'metric-positive' : 'metric-negative');
  });
}

async function loadMarket() {
  const response = await fetch(dexUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`DEX Screener HTTP ${response.status}`);
  const payload = await response.json();
  const pair = payload && Array.isArray(payload.pairs) ? payload.pairs[0] : null;
  if (!pair) throw new Error('SUNV pair was not returned by DEX Screener');

  setField('price', money(pair.priceUsd, 8));
  setField('priceNative', pair.priceNative ? `${Number(pair.priceNative).toLocaleString(undefined, { maximumSignificantDigits: 7 })} USDG` : '— USDG');
  setField('liquidity', money(pair.liquidity && pair.liquidity.usd));
  setField('volume24', money(pair.volume && pair.volume.h24));
  setField('change24', percent(pair.priceChange && pair.priceChange.h24));
  styleChange(pair.priceChange && pair.priceChange.h24);
  setField('fdv', compactMoney(pair.fdv));
  setField('marketCap', pair.marketCap == null ? 'Not verified' : compactMoney(pair.marketCap));

  const buys = Number(pair.txns && pair.txns.h24 && pair.txns.h24.buys) || 0;
  const sells = Number(pair.txns && pair.txns.h24 && pair.txns.h24.sells) || 0;
  const total = buys + sells;
  setField('buys24', buys.toLocaleString());
  setField('sells24', sells.toLocaleString());
  setField('txns24', total.toLocaleString());

  const buyPct = total ? (buys / total) * 100 : 50;
  const sellPct = total ? (sells / total) * 100 : 50;
  document.getElementById('buyBar').style.width = buyPct + '%';
  document.getElementById('sellBar').style.width = sellPct + '%';
  setField('buyPct', total ? buyPct.toFixed(1) + '%' : '—');
  setField('sellPct', total ? sellPct.toFixed(1) + '%' : '—');

  setField('poolAge', formatAge(pair.pairCreatedAt));
  if (pair.pairCreatedAt) {
    setField('poolCreated', new Date(Number(pair.pairCreatedAt)).toLocaleString());
  }
}

async function loadHolders() {
  const response = await fetch(holdersUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Blockscout HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.result)) throw new Error('Holder list unavailable');

  const count = payload.result.length;
  setField('holders', count >= 1000 ? '1,000+' : count.toLocaleString());
  document.getElementById('holderNote').textContent =
    count >= 1000
      ? 'At least 1,000 holder addresses returned. Verify the exact count on Blockscout.'
      : `Blockscout returned ${count.toLocaleString()} holder address${count === 1 ? '' : 'es'}.`;
}

let refreshing = false;
async function refreshDashboard() {
  if (refreshing) return;
  refreshing = true;

  const state = document.getElementById('refreshState');
  const button = document.getElementById('refreshButton');
  const dot = document.getElementById('liveDot');
  state.textContent = 'Refreshing…';
  button.disabled = true;

  const results = await Promise.allSettled([loadMarket(), loadHolders()]);
  const failures = results.filter((r) => r.status === 'rejected');

  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  if (failures.length === 0) {
    state.textContent = 'Live sources connected';
    dot.classList.remove('status-warning');
  } else if (failures.length === 1) {
    state.textContent = 'One live source unavailable — verify with direct links';
    dot.classList.add('status-warning');
  } else {
    state.textContent = 'Live sources unavailable — use direct source links';
    dot.classList.add('status-warning');
  }

  refreshing = false;
  button.disabled = false;
}

document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
refreshDashboard();
setInterval(refreshDashboard, 60000);
