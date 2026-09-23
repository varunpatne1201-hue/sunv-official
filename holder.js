const HOLDER_API = 'https://sunv-data-api.onrender.com';
const TOTAL_SUPPLY = 100000000;

const input = document.getElementById('walletAddress');
const verifyButton = document.getElementById('verifyButton');
const connectButton = document.getElementById('connectButton');
const clearButton = document.getElementById('clearButton');
const copyLinkButton = document.getElementById('copyLinkButton');
const shareResultButton = document.getElementById('shareResultButton');
const message = document.getElementById('holderMessage');

let currentResult = null;

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

function formatCheckedTime(date) {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function shareUrl(address) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('address', address);
  return url.toString();
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function setLoading(on) {
  verifyButton.disabled = on;
  connectButton.disabled = on;
  verifyButton.textContent = on ? 'Checking…' : 'Verify holdings';
}

function resetActivity() {
  document.getElementById('receivedCount').textContent = '—';
  document.getElementById('sentCount').textContent = '—';
  document.getElementById('activityStatus').textContent = 'Not checked';
  document.getElementById('activityScanNote').textContent = 'Verify a wallet to load recent activity.';
  document.getElementById('transferList').innerHTML =
    '<div class="transfer-empty">Verify a wallet to load recent SUNV transfer activity.</div>';
}

function resetResult() {
  currentResult = null;
  resetActivity();
  document.getElementById('holderStatus').textContent = 'No wallet checked yet';
  document.getElementById('holderBadge').textContent = 'READ-ONLY';
  document.getElementById('holderBadge').classList.remove('holder-badge-positive');
  document.getElementById('sunvBalance').textContent = '—';
  document.getElementById('estimatedValue').textContent = '—';
  document.getElementById('supplyShare').textContent = '—';
  document.getElementById('checkedAddress').textContent = '—';
  document.getElementById('verifiedAt').textContent = '—';
  document.getElementById('explorerLink').href = 'https://robinhoodchain.blockscout.com/';
  copyLinkButton.disabled = true;
  shareResultButton.disabled = true;
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

async function fetchActivity(address) {
  const response = await fetch(HOLDER_API + '/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ address })
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.detail || payload.error || 'Activity lookup failed');
  }
  return payload;
}

function shortAddress(address) {
  if (!address) return 'Unknown';
  if (/^0x0{40}$/i.test(address)) return 'Mint / zero address';
  return address.slice(0, 6) + '…' + address.slice(-4);
}

function renderActivity(payload) {
  const transfers = Array.isArray(payload?.transfers) ? payload.transfers : [];
  const incoming = transfers.filter((t) => t.direction === 'IN').length;
  const outgoing = transfers.filter((t) => t.direction === 'OUT').length;

  document.getElementById('receivedCount').textContent = incoming.toLocaleString();
  document.getElementById('sentCount').textContent = outgoing.toLocaleString();
  document.getElementById('activityStatus').textContent = transfers.length ? 'Loaded' : 'No recent transfers';
  document.getElementById('activityScanNote').textContent =
    transfers.length
      ? 'Showing up to 20 recent SUNV transfer events found in the current RPC scan window.'
      : 'No SUNV transfer events were found for this wallet in the current RPC scan window.';

  const list = document.getElementById('transferList');
  if (!transfers.length) {
    list.innerHTML = '<div class="transfer-empty">No recent SUNV transfers found in the current scan window.</div>';
    return;
  }

  list.innerHTML = transfers.map((transfer) => {
    const zeroFrom = /^0x0{40}$/i.test(transfer.from || '');
    const zeroTo = /^0x0{40}$/i.test(transfer.to || '');
    let label = transfer.direction === 'IN' ? 'RECEIVED' : transfer.direction === 'OUT' ? 'SENT' : 'SELF';
    if (zeroFrom && transfer.direction === 'IN') label = 'MINT';
    if (zeroTo && transfer.direction === 'OUT') label = 'BURN';

    const amount = formatSunv(transfer.amountSunv);
    const when = transfer.timestamp ? new Date(transfer.timestamp).toLocaleString() : 'Timestamp unavailable';
    const counterparty = shortAddress(transfer.counterparty);
    const txUrl = 'https://robinhoodchain.blockscout.com/tx/' + transfer.txHash;

    return '<article class="transfer-row">' +
      '<div class="transfer-direction transfer-' + label.toLowerCase() + '">' + label + '</div>' +
      '<div class="transfer-main"><strong>' + amount + ' SUNV</strong><span>' +
      ((label === 'RECEIVED' || label === 'MINT') ? 'From' : (label === 'SENT' || label === 'BURN') ? 'To' : 'Wallet') +
      ': ' + counterparty + '</span></div>' +
      '<div class="transfer-meta"><span>' + when + '</span><a href="' + txUrl + '" target="_blank" rel="noopener noreferrer">Verify tx ↗</a></div>' +
      '</article>';
  }).join('');
}

async function loadActivity(address) {
  document.getElementById('activityStatus').textContent = 'Loading…';
  document.getElementById('activityScanNote').textContent = 'Reading SUNV Transfer events from Robinhood Chain.';
  document.getElementById('transferList').innerHTML = '<div class="transfer-empty">Loading recent transfer activity…</div>';

  try {
    const payload = await fetchActivity(address);
    renderActivity(payload);
  } catch (error) {
    document.getElementById('receivedCount').textContent = '—';
    document.getElementById('sentCount').textContent = '—';
    document.getElementById('activityStatus').textContent = 'Unavailable';
    document.getElementById('activityScanNote').textContent = 'Recent transfer activity could not be loaded right now.';
    document.getElementById('transferList').innerHTML =
      '<div class="transfer-empty">Activity feed temporarily unavailable. Use Blockscout from the wallet result to verify transactions.</div>';
  }
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

async function verifyAddress(addressValue, options = {}) {
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
    const checkedAt = new Date();
    const estimatedValue = price !== null && Number.isFinite(balance) ? balance * price : null;
    const supplyPct = Number.isFinite(balance) ? (balance / TOTAL_SUPPLY) * 100 : null;

    currentResult = {
      address,
      balance,
      price,
      estimatedValue,
      supplyPct,
      checkedAt
    };

    document.getElementById('holderStatus').textContent =
      isHolder ? 'SUNV holdings verified onchain' : 'No SUNV detected in this wallet';
    document.getElementById('holderBadge').textContent =
      isHolder ? 'HOLDER VERIFIED' : 'NO BALANCE';
    document.getElementById('holderBadge').classList.toggle('holder-badge-positive', isHolder);
    document.getElementById('sunvBalance').textContent = formatSunv(balance) + ' SUNV';
    document.getElementById('estimatedValue').textContent =
      estimatedValue === null ? 'Unavailable' : formatMoney(estimatedValue);
    document.getElementById('supplyShare').textContent =
      supplyPct === null ? '—' : (supplyPct === 0 ? '0%' : supplyPct.toLocaleString(undefined, { maximumFractionDigits: 8 }) + '%');
    document.getElementById('checkedAddress').textContent = address;
    document.getElementById('verifiedAt').textContent = formatCheckedTime(checkedAt);
    document.getElementById('explorerLink').href =
      'https://robinhoodchain.blockscout.com/address/' + address;

    copyLinkButton.disabled = false;
    shareResultButton.disabled = false;

    const url = shareUrl(address);
    if (!options.skipHistory) {
      history.replaceState(null, '', url);
    }

    const valueText = estimatedValue !== null ? ' · approx. ' + formatMoney(estimatedValue) : '';
    message.textContent =
      'Verified: ' + formatSunv(balance) + ' SUNV' + valueText + '. No signature or transaction was requested.';

    loadActivity(address);

    document.getElementById('resultCard').scrollIntoView({
      behavior: options.noScroll ? 'auto' : 'smooth',
      block: 'center'
    });
  } catch (error) {
    currentResult = null;
    copyLinkButton.disabled = true;
    shareResultButton.disabled = true;
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

copyLinkButton.addEventListener('click', async () => {
  if (!currentResult) return;
  try {
    await copyText(shareUrl(currentResult.address));
    const old = copyLinkButton.textContent;
    copyLinkButton.textContent = 'Link copied ✓';
    setTimeout(() => { copyLinkButton.textContent = old; }, 1800);
  } catch {
    message.textContent = 'Could not copy automatically. Copy the page URL from your browser.';
  }
});

shareResultButton.addEventListener('click', async () => {
  if (!currentResult) return;

  const title = 'SUNV Holder Hub — Live Wallet Check';
  const valueText = currentResult.estimatedValue === null
    ? ''
    : ' · displayed value ' + formatMoney(currentResult.estimatedValue);
  const text =
    'Public wallet ' + currentResult.address +
    ' held ' + formatSunv(currentResult.balance) + ' SUNV' + valueText +
    ' when checked at ' + formatCheckedTime(currentResult.checkedAt) +
    '. Open the link for a fresh onchain check. Wallet ownership is not asserted.';

  const url = shareUrl(currentResult.address);

  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
    } else {
      await copyText(text + '\n' + url);
      const old = shareResultButton.textContent;
      shareResultButton.textContent = 'Summary copied ✓';
      setTimeout(() => { shareResultButton.textContent = old; }, 1800);
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    message.textContent = 'Sharing was unavailable. Use “Copy verification link” instead.';
  }
});

clearButton.addEventListener('click', () => {
  input.value = '';
  resetResult();
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  history.replaceState(null, '', url.toString());
  message.textContent = 'Ready to verify a wallet on Robinhood Chain.';
  input.focus();
});

resetResult();

const deepLinkAddress = new URLSearchParams(window.location.search).get('address');
if (validAddress(deepLinkAddress)) {
  input.value = deepLinkAddress;
  verifyAddress(deepLinkAddress, { skipHistory: true, noScroll: true });
}