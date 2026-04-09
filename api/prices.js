/**
 * Vercel Serverless Function — /api/prices
 * POST { symbols: string[], technicals?: string[] } → { prices, changes, technicals }
 *
 * technicals array requests 50D SMA, RSI, 52W high/low, 1M ROC for those symbols.
 */
const https = require('https');

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: YF_HEADERS }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchQuotes(symbols) {
  const qs = symbols.map(encodeURIComponent).join('%2C');
  const fields = [
    'regularMarketPrice', 'regularMarketChangePercent', 'regularMarketPreviousClose',
    'fiftyDayAverage', 'twoHundredDayAverage', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow',
    'symbol'
  ].join('%2C');
  const url = `https://query2.finance.yahoo.com/v8/finance/quote?symbols=${qs}&fields=${fields}`;

  try {
    const data = await fetchJSON(url);
    const results = data?.quoteResponse?.result || [];
    const prices = {}, changes = {}, extras = {};

    results.forEach(q => {
      const sym = q.symbol;
      prices[sym] = q.regularMarketPrice ?? null;
      changes[sym] = q.regularMarketChangePercent ?? null;
      extras[sym] = {
        prevClose: q.regularMarketPreviousClose ?? null,
        fiftyDayAvg: q.fiftyDayAverage ?? null,
        twoHundredDayAvg: q.twoHundredDayAverage ?? null,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
      };
    });

    return { prices, changes, extras };
  } catch (e) {
    return { prices: {}, changes: {}, extras: {} };
  }
}

/**
 * Fetch chart data for RSI and 1M ROC calculation
 * Uses 3-month daily data to compute 14-day RSI and 1-month rate of change
 */
async function fetchTechnicals(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;
  try {
    const data = await fetchJSON(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close?.filter(c => c != null) || [];
    if (closes.length < 15) return null;

    // 14-day RSI
    const rsi = calcRSI(closes, 14);

    // 1M ROC (approx 21 trading days)
    const lookback = Math.min(21, closes.length - 1);
    const oldPrice = closes[closes.length - 1 - lookback];
    const newPrice = closes[closes.length - 1];
    const roc1m = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : null;

    // 50D SMA from closes
    const sma50 = closes.length >= 50
      ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50
      : null;

    return { rsi, roc1m, sma50 };
  } catch {
    return null;
  }
}

function calcRSI(closes, period) {
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

  try {
    const { prices, changes, extras } = await fetchQuotes(symbols);

    // Fetch technicals for requested symbols (RSI, 1M ROC, computed 50D SMA)
    let technicals = {};
    if (Array.isArray(techSymbols) && techSymbols.length) {
      const techResults = await Promise.all(
        techSymbols.map(async sym => {
          const t = await fetchTechnicals(sym);
          return [sym, t];
        })
      );
      techResults.forEach(([sym, t]) => {
        if (t) {
          // Merge with extras from quote endpoint
          const e = extras[sym] || {};
          technicals[sym] = {
            rsi: t.rsi,
            roc1m: t.roc1m,
            sma50: t.sma50 ?? e.fiftyDayAvg,
            fiftyDayAvg: e.fiftyDayAvg,
            twoHundredDayAvg: e.twoHundredDayAvg,
            fiftyTwoWeekHigh: e.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: e.fiftyTwoWeekLow,
            prevClose: e.prevClose,
          };
        }
      });
    }

    res.status(200).json({ prices, changes, extras, technicals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
