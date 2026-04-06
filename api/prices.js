/**
 * Vercel Serverless Function — /api/prices
 * POST { symbols: string[] } → { prices, changes }
 */
const https = require('https');

function fetchYahooV7(symbols) {
  return new Promise((resolve, reject) => {
    const qs     = symbols.map(encodeURIComponent).join('%2C');
    const fields = 'regularMarketPrice%2CregularMarketChangePercent%2Csymbol';
    const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qs}&fields=${fields}`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d)?.quoteResponse?.result || [];
          const prices = {}, changes = {};
          r.forEach(q => {
            prices[q.symbol]  = q.regularMarketPrice         ?? null;
            changes[q.symbol] = q.regularMarketChangePercent ?? null;
          });
          resolve({ prices, changes });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchYahooV8Single(symbol) {
  return new Promise((resolve) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const meta = JSON.parse(d)?.chart?.result?.[0]?.meta;
          resolve({ price: meta?.regularMarketPrice ?? null, change: meta?.regularMarketChangePercent ?? null });
        } catch { resolve({ price: null, change: null }); }
      });
    }).on('error', () => resolve({ price: null, change: null }));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbols } = req.body || {};
  if (!Array.isArray(symbols) || !symbols.length) {
    return res.status(400).json({ error: '`symbols` array required' });
  }

  try {
    let { prices, changes } = await fetchYahooV7(symbols);
    const missing = symbols.filter(s => prices[s] == null);
    if (missing.length) {
      await Promise.all(missing.map(async s => {
        const { price, change } = await fetchYahooV8Single(s);
        if (price != null) { prices[s] = price; changes[s] = change; }
      }));
    }
    res.status(200).json({ prices, changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
