const HOLDER_API = 'https://sunv-data-api.onrender.com';
const TOTAL_SUPPLY = 100000000;
const CONTRACT = '0x22fd16577ba869A7df77F4280ae08c65BB03111d';

const input = document.getElementById('walletAddress');
const verifyButton = document.getElementById('verifyButton');
const connectButton = document.getElementById('connectButton');
const clearButton = document.getElementById('clearButton');
const message = document.getElementById('holderMessage');

function validAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim());
}

function formatSunv(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Unavailable';
  if (Math.abs(n) < 0.01 && n !== 0) {
    return '$' + n.toLocaleString(undefined, { maximumSignificantDigits: 5 });
  }
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function setLoading(on) {
  verifyButton.disabled = on;
  connectButton.disabled = on;
  verifyButton.textContent = on ? 'Checking…' : 'Verify holdings';
}

function resetResult() {
  document.getElementById('holderStatus').textContent = 'No wallet checked yet';
  document.getElementById('holderBadge').textContent = 'READ-ONLY';
  document.getElementById('holderBadge').classList.remove('holder-badge-positive');
  document.getElementById('sunvBalance').textContent = '—';
  document.getElementById('estimatedValue').textContent = '—';
  document.getElementById('supplyShare').textContent = '—';
  document.getElementById('checkedAddress').textContent = '—';
  document.getElementById('explorerLink').href = 'https://robinhoodchain.blockscout.com/';
}

async function fetchBalance(address) {
  const response = await fetch(HOLDER_API + '/api/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ address })
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.detail || payload.error || 'Balance lookup failed');
  }
  return payload;
}

async function fetchMarketPrice() {
  try {
    const response = await fetch(HOLDER_API + '/api/market', { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json();
    const price = Number(payload.priceUsd);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function verifyAddress(addressValue) {
  const address = String(addressValue || '').trim();
  if (!validAddress(address)) {
    message.textContent = 'Enter a valid EVM wallet address beginning with 0x.';
    return;
  }

  setLoading(true);
  message.textContent = 'Reading the canonical SUNV balance from Robinhood Chain…';

  try {
    const [balanceData, price] = await Promise.all([
      fetchBalance(address),
      fetchMarketPrice()
    ]);

    const balance = Number(balanceData.balanceSunv);
    const isHolder = Number.isFinite(balance) && balance > 0;

    document.getElementById('holderStatus').textContent =
      isHolder ? 'SUNV holdings verified onchain' : 'No SUNV detected in this wallet';
    document.getElementById('holderBadge').textContent =
      isHolder ? 'HOLDER VERIFIED' : 'NO BALANCE';
    document.getElementById('holderBadge').classList.toggle('holder-badge-positive', isHolder);
    document.getElementById('sunvBalance').textContent = formatSunv(balance) + ' SUNV';

    if (price !== null && Number.isFinite(balance)) {
      document.getElementById('estimatedValue').textContent = formatMoney(balance * price);
    } else {
      document.getElementById('estimatedValue').textContent = 'Unavailable';
    }

    if (Number.isFinite(balance)) {
      const pct = (balance / TOTAL_SUPPLY) * 100;
      document.getElementById('supplyShare').textContent =
        pct === 0 ? '0%' : pct.toLocaleString(undefined, { maximumFractionDigits: 8 }) + '%';
    }

    document.getElementById('checkedAddress').textContent = address;
    document.getElementById('explorerLink').href =
      'https://robinhoodchain.blockscout.com/address/' + address;

    const valueText =
      price !== null && Number.isFinite(balance) ? ' · approx. ' + formatMoney(balance * price) : '';
    message.textContent =
      'Verified: ' + formatSunv(balance) + ' SUNV' + valueText + '. No signature or transaction was requested.';

    document.getElementById('resultCard').scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  } catch (error) {
    message.textContent = 'Unable to verify right now: ' + (error.message || 'unknown error');
  } finally {
    setLoading(false);
  }
}

verifyButton.addEventListener('click', () => verifyAddress(input.value));
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') verifyAddress(input.value);
});

connectButton.addEventListener('click', async () => {
  if (!window.ethereum) {
    message.textContent = 'No browser EVM wallet was detected. You can still paste a public wallet address above.';
    return;
  }

  try {
    setLoading(true);
    message.textContent = 'Requesting your public wallet address. No signature will be requested.';
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts && accounts[0];
    if (!validAddress(address)) throw new Error('Wallet did not return a valid address');
    input.value = address;
    await verifyAddress(address);
  } catch (error) {
    message.textContent = 'Wallet connection was cancelled or unavailable. You can paste a public address instead.';
    setLoading(false);
  }
});

clearButton.addEventListener('click', () => {
  input.value = '';
  resetResult();
  message.textContent = 'Ready to verify a wallet on Robinhood Chain.';
  input.focus();
});

resetResult();
