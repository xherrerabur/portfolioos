/**
 * Vercel Serverless Function — /api/prices
 * POST { symbols: string[], technicals?: string[] } → { prices, changes, extras, technicals }
 *
 * Data sources:
 *   - CoinGecko (free, no key blocking) for all crypto
 *   - Finnhub (requires FINNHUB_API_KEY env var) for equities + FX
 *
 * Backwards-compatible with the old Yahoo-style symbol names used in index.html:
 *   SOL-AUD, ETH-AUD, DOGE-AUD, SUI20947-USD, PENGU28905-USD, AMZN, AUDUSD=X
 */
const https = require('https');

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';

// Symbol → data source mapping
// `id` is the CoinGecko coin id or the Finnhub symbol/forex pair
const SYMBOL_MAP = {
  // Crypto — all priced in AUD directly via CoinGecko
  'SOL-AUD':        { source: 'coingecko', id: 'solana',         vs: 'aud' },
  'ETH-AUD':        { source: 'coingecko', id: 'ethereum',       vs: 'aud' },
  'DOGE-AUD':       { source: 'coingecko', id: 'dogecoin',       vs: 'aud' },
  'SUI20947-USD':   { source: 'coingecko', id: 'sui',            vs: 'aud' },
  'PENGU28905-USD': { source: 'coingecko', id: 'pudgy-penguins', vs: 'aud' },
  'BTC-AUD':        { source: 'coingecko', id: 'bitcoin',        vs: 'aud' },
  'ETH-USD':        { source: 'coingecko', id: 'ethereum',       vs: 'usd' },
  'BTC-USD':        { source: 'coingecko', id: 'bitcoin',        vs: 'usd' },

  // US equities + ETFs via Finnhub
  'AMZN':   { source: 'finnhub', id: 'AMZN' },

  // FX — Finnhub forex or inverse of USD/AUD
  'AUDUSD=X': { source: 'finnhub-fx', id: 'OANDA:AUD_USD' },
};

// ---------- HTTP helper ----------
function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'PortfolioOS/1.0',
        'Accept': 'application/json',
        ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---------- CoinGecko ----------
/**
 * Batch fetch simple prices + 24h change for multiple CoinGecko ids.
 * Returns { id: { aud: price, aud_24h_change: pct } }
 */
async function fetchCoinGeckoPrices(ids, vs = 'aud') {
  if (!ids.length) return {};
  const idsParam = ids.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=${vs}&include_24hr_change=true`;
  try {
    return await fetchJSON(url);
  } catch (e) {
    console.error('CoinGecko fetch failed:', e.message);
    return {};
  }
}

/**
 * Fetch 90-day daily market chart for a CoinGecko id to compute technicals.
 * Returns array of daily closes (most recent last).
 */
async function fetchCoinGeckoCandles(id, vs = 'aud', days = 90) {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${vs}&days=${days}&interval=daily`;
  try {
    const data = await fetchJSON(url);
    const prices = data?.prices || [];
    return prices.map(p => p[1]).filter(p => p != null);
  } catch (e) {
    console.error(`CoinGecko candles failed for ${id}:`, e.message);
    return [];
  }
}

// ---------- Finnhub ----------
async function fetchFinnhubQuote(symbol) {
  if (!FINNHUB_KEY) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  try {
    const data = await fetchJSON(url);
    // Finnhub returns: { c, d, dp, h, l, o, pc, t }
    if (data && typeof data.c === 'number' && data.c > 0) {
      return {
        price: data.c,
        changePct: data.dp,
        prevClose: data.pc,
        high: data.h,
        low: data.l,
        open: data.o,
      };
    }
    return null;
  } catch (e) {
    console.error(`Finnhub quote failed for ${symbol}:`, e.message);
    return null;
  }
}

async function fetchFinnhubForex(pair) {
  if (!FINNHUB_KEY) return null;
  // Finnhub forex quote: use /quote with symbol like 'OANDA:AUD_USD'
  return fetchFinnhubQuote(pair);
}

/**
 * Fetch daily candles for a Finnhub symbol to compute technicals.
 * Returns array of closes (most recent last).
 */
async function fetchFinnhubCandles(symbol, days = 90) {
  if (!FINNHUB_KEY) return [];
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
  try {
    const data = await fetchJSON(url);
    if (data && data.s === 'ok' && Array.isArray(data.c)) return data.c;
    return [];
  } catch (e) {
    console.error(`Finnhub candles failed for ${symbol}:`, e.message);
    return [];
  }
}

// ---------- Technical indicators ----------
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeTechnicals(closes) {
  if (!closes || closes.length < 15) return null;
  const rsi = calcRSI(closes, 14);
  const lookback = Math.min(21, closes.length - 1);
  const oldPrice = closes[closes.length - 1 - lookback];
  const newPrice = closes[closes.length - 1];
  const roc1m = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : null;
  const sma50 = closes.length >= 50
    ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50
    : closes.reduce((s, v) => s + v, 0) / closes.length;
  const fiftyTwoWeekHigh = Math.max(...closes);
  const fiftyTwoWeekLow = Math.min(...closes);
  return { rsi, roc1m, sma50, fiftyTwoWeekHigh, fiftyTwoWeekLow };
}

// ---------- Main handler ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbols, technicals: techSymbols } = req.body || {};
  if (!Array.isArray(symbols) || !symbols.length) {
    return res.status(400).json({ error: '`symbols` array required' });
  }

  const prices = {}, changes = {}, extras = {}, technicals = {}, errors = [];

  // Split symbols by source
  const cgIds = [];      // coingecko ids to fetch in one batch
  const cgSymbolToId = {};
  const finnhubSyms = [];

  symbols.forEach(sym => {
    const mapping = SYMBOL_MAP[sym];
    if (!mapping) { errors.push(`Unknown symbol: ${sym}`); return; }
    if (mapping.source === 'coingecko') {
      cgIds.push(mapping.id);
      cgSymbolToId[sym] = mapping.id;
    } else if (mapping.source === 'finnhub' || mapping.source === 'finnhub-fx') {
      finnhubSyms.push({ sym, id: mapping.id });
    }
  });

  // Batch CoinGecko
  if (cgIds.length) {
    const cgData = await fetchCoinGeckoPrices([...new Set(cgIds)], 'aud');
    for (const sym of symbols) {
      const id = cgSymbolToId[sym];
      if (id && cgData[id]) {
        prices[sym] = cgData[id].aud;
        changes[sym] = cgData[id].aud_24h_change ?? null;
        extras[sym] = {};
      }
    }
  }

  // Finnhub (parallel)
  await Promise.all(finnhubSyms.map(async ({ sym, id }) => {
    const q = await fetchFinnhubQuote(id);
    if (q) {
      prices[sym] = q.price;
      changes[sym] = q.changePct ?? null;
      extras[sym] = {
        prevClose: q.prevClose,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
      };
    }
  }));

  // Technicals (parallel) — compute from historical candles
  if (Array.isArray(techSymbols) && techSymbols.length) {
    await Promise.all(techSymbols.map(async sym => {
      const mapping = SYMBOL_MAP[sym];
      if (!mapping) return;
      let closes = [];
      if (mapping.source === 'coingecko') {
        closes = await fetchCoinGeckoCandles(mapping.id, 'aud', 90);
      } else if (mapping.source === 'finnhub') {
        closes = await fetchFinnhubCandles(mapping.id, 90);
      }
      const t = computeTechnicals(closes);
      if (t) {
        technicals[sym] = {
          rsi: t.rsi,
          roc1m: t.roc1m,
          sma50: t.sma50,
          fiftyDayAvg: t.sma50,
          fiftyTwoWeekHigh: t.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: t.fiftyTwoWeekLow,
        };
        // also backfill extras
        if (!extras[sym]) extras[sym] = {};
        extras[sym].fiftyTwoWeekHigh = t.fiftyTwoWeekHigh;
        extras[sym].fiftyTwoWeekLow = t.fiftyTwoWeekLow;
        extras[sym].fiftyDayAvg = t.sma50;
      }
    }));
  }

  res.status(200).json({
    prices,
    changes,
    extras,
    technicals,
    errors: errors.length ? errors : undefined,
    _meta: {
      finnhubConfigured: !!FINNHUB_KEY,
      coingeckoSymbols: cgIds.length,
      finnhubSymbols: finnhubSyms.length,
    },
  });
};
