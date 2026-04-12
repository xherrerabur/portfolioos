/**
 * Vercel Serverless Function — /api/history
 * POST { symbols: string[], days?: number } → { series: { [symbol]: [[ms, priceAUD], ...] } }
 *
 * Returns daily historical AUD closes for each requested symbol, used to
 * compute period returns (1W / 1M / 3M / YTD / 1Y) on the dashboard.
 *
 * Crypto symbols (mapped via SYMBOL_MAP) are fetched from CoinGecko's free
 * /coins/{id}/market_chart endpoint at vs_currency=aud, which already returns
 * AUD-denominated closes.
 *
 * Equity symbols (e.g. AMZN) are NOT supported here yet — Finnhub free tier
 * blocks /stock/candle. They are silently omitted from the response so the
 * dashboard footnote can flag them.
 */
const https = require('https');

// Same mapping shape as api/prices.js — duplicated intentionally to keep
// the function self-contained (Vercel deploys files independently).
const SYMBOL_MAP = {
  'SOL-AUD':        { source: 'coingecko', id: 'solana' },
  'ETH-AUD':        { source: 'coingecko', id: 'ethereum' },
  'DOGE-AUD':       { source: 'coingecko', id: 'dogecoin' },
  'SUI20947-USD':   { source: 'coingecko', id: 'sui' },
  'PENGU28905-USD': { source: 'coingecko', id: 'pudgy-penguins' },
  'BTC-AUD':        { source: 'coingecko', id: 'bitcoin' },
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PortfolioOS/1.0', 'Accept': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/**
 * Fetch N-day daily history for a single CoinGecko id, in AUD.
 * Returns an array of [timestamp_ms, price_aud] pairs (already in CG format).
 */
async function fetchCoinGeckoHistory(id, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=aud&days=${days}&interval=daily`;
  try {
    const data = await fetchJSON(url);
    return Array.isArray(data?.prices) ? data.prices : [];
  } catch (e) {
    console.error(`history fetch failed for ${id}:`, e.message);
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbols, days } = req.body || {};
  if (!Array.isArray(symbols) || !symbols.length) {
    return res.status(400).json({ error: '`symbols` array required' });
  }
  const lookback = Math.min(Math.max(parseInt(days, 10) || 400, 30), 400);

  const series = {};
  const skipped = [];

  // Parallel fetch — CoinGecko free tier handles small bursts fine.
  await Promise.all(symbols.map(async sym => {
    const mapping = SYMBOL_MAP[sym];
    if (!mapping || mapping.source !== 'coingecko') { skipped.push(sym); return; }
    const points = await fetchCoinGeckoHistory(mapping.id, lookback);
    if (points.length) series[sym] = points;
    else skipped.push(sym);
  }));

  res.status(200).json({
    series,
    skipped: skipped.length ? skipped : undefined,
    _meta: { days: lookback, requested: symbols.length, fulfilled: Object.keys(series).length },
  });
};
