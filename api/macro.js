/**
 * Vercel Serverless Function — /api/macro
 * POST {} → { briefing, indicators }
 * Requires ANTHROPIC_API_KEY environment variable set in Vercel dashboard.
 */
const https = require('https');

const MACRO_SYMBOLS = [
  '^GSPC', '^IXIC', '^VIX', '^TNX', '^TYX', '^IRX',
  'GLD', 'TLT', 'DX-Y.NYB', 'BTC-AUD', 'ETH-AUD', 'SOL-AUD', 'AUDUSD=X',
];

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
          r.forEach(q => { prices[q.symbol] = q.regularMarketPrice ?? null; changes[q.symbol] = q.regularMarketChangePercent ?? null; });
          resolve({ prices, changes });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function callClaude(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
    const req  = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables.' });

  try {
    const { prices, changes } = await fetchYahooV7(MACRO_SYMBOLS);
    const fmt  = (v, d=2) => v != null ? v.toFixed(d) : 'N/A';
    const fmtC = (v)      => v != null ? (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : 'N/A';
    const m = {
      sp500: fmt(prices['^GSPC']), sp500_chg: fmtC(changes['^GSPC']),
      nasdaq: fmt(prices['^IXIC']), nasdaq_chg: fmtC(changes['^IXIC']),
      vix: fmt(prices['^VIX']), tnx: fmt(prices['^TNX']), tyx: fmt(prices['^TYX']), irx: fmt(prices['^IRX']),
      gld: fmt(prices['GLD']), gld_chg: fmtC(changes['GLD']),
      tlt: fmt(prices['TLT']), tlt_chg: fmtC(changes['TLT']),
      usd: fmt(prices['DX-Y.NYB']), usd_chg: fmtC(changes['DX-Y.NYB']),
      btc: prices['BTC-AUD'] != null ? Math.round(prices['BTC-AUD']).toLocaleString() : 'N/A', btc_chg: fmtC(changes['BTC-AUD']),
      eth: prices['ETH-AUD'] != null ? Math.round(prices['ETH-AUD']).toLocaleString() : 'N/A', eth_chg: fmtC(changes['ETH-AUD']),
      sol: fmt(prices['SOL-AUD']), sol_chg: fmtC(changes['SOL-AUD']),
      audusd: fmt(prices['AUDUSD=X'], 4),
    };

    const prompt = `You are a sharp macro analyst writing a morning briefing for a personal investment dashboard.

LIVE MARKET DATA:
- S&P 500: ${m.sp500} (${m.sp500_chg}% today)
- NASDAQ: ${m.nasdaq} (${m.nasdaq_chg}% today)
- VIX: ${m.vix} | 3M Treasury: ${m.irx}% | 10Y Treasury: ${m.tnx}% | 30Y Treasury: ${m.tyx}%
- Gold (GLD): $${m.gld} (${m.gld_chg}% today) | 20Y Bond ETF (TLT): $${m.tlt} (${m.tlt_chg}% today)
- USD Index: ${m.usd} (${m.usd_chg}% today) | AUD/USD: ${m.audusd}
- Bitcoin: A$${m.btc} (${m.btc_chg}% today) | Ethereum: A$${m.eth} (${m.eth_chg}% today) | Solana: A$${m.sol} (${m.sol_chg}% today)

PORTFOLIO CONTEXT: 82% crypto (SOL, ETH, DOGE, SUI), 18% US equities (AMZN). Total cost basis A$25,959. Portfolio is AUD-denominated.

Return ONLY valid JSON (no markdown):
{"headline":"One-line regime summary max 10 words","sections":[{"icon":"monitoring","color":"#3fb950","label":"EQUITIES","text":"2-3 sentences"},{"icon":"currency_bitcoin","color":"#f0883e","label":"CRYPTO","text":"2-3 sentences"},{"icon":"account_balance","color":"#58a6ff","label":"RATES & BONDS","text":"2-3 sentences"},{"icon":"public","color":"#8b949e","label":"MACRO & FX","text":"2-3 sentences"}]}`;

    const result = await callClaude(prompt, apiKey);
    const raw    = result?.content?.[0]?.text || '';
    let briefing;
    try { briefing = JSON.parse(raw.replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/i,'').trim()); }
    catch { briefing = { headline: 'Briefing generated', sections: [{ icon:'info', color:'#8b949e', label:'BRIEFING', text: raw }] }; }

    res.status(200).json({ briefing, indicators: m });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
