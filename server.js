/**
 * PortfolioOS — Local Proxy Server
 * Standalone Node.js, no npm deps. Run: node server.js
 *
 * Endpoints:
 *   GET  /health          — health check
 *   POST /api/prices      — { symbols: string[] }  → { prices, changes }
 *   POST /api/macro       — { key?: string }        → { briefing, indicators, raw }
 *
 * Environment:
 *   PORT            (default 3001)
 *   ANTHROPIC_API_KEY   — required for /api/macro AI briefing
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const PORT  = process.env.PORT || 3001;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/* ── Yahoo Finance helpers ──────────────────────────────────────────────── */

function fetchYahooV7(symbols) {
  return new Promise((resolve, reject) => {
    const qs     = symbols.map(encodeURIComponent).join('%2C');
    const fields = 'regularMarketPrice%2CregularMarketChangePercent%2Csymbol%2CshortName';
    const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qs}&fields=${fields}`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d)?.quoteResponse?.result || [];
          const prices = {}, changes = {}, names = {};
          r.forEach(q => {
            prices[q.symbol]  = q.regularMarketPrice         ?? null;
            changes[q.symbol] = q.regularMarketChangePercent ?? null;
            names[q.symbol]   = q.shortName                  ?? q.symbol;
          });
          resolve({ prices, changes, names });
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

/* ── Claude API ─────────────────────────────────────────────────────────── */

function callClaude(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── Macro indicators fetch ─────────────────────────────────────────────── */

const MACRO_SYMBOLS = [
  '^GSPC',      // S&P 500
  '^IXIC',      // NASDAQ
  '^VIX',       // VIX
  '^TNX',       // 10Y Treasury yield
  '^TYX',       // 30Y Treasury yield
  '^IRX',       // 3M Treasury yield
  'GLD',        // Gold ETF
  'TLT',        // 20Y Bond ETF
  'DX-Y.NYB',  // USD Index
  'BTC-AUD',    // Bitcoin (AUD)
  'ETH-AUD',    // Ethereum (AUD)
  'SOL-AUD',    // Solana (AUD)
  'AUDUSD=X',   // AUD/USD rate
];

async function fetchMacroData() {
  const { prices, changes } = await fetchYahooV7(MACRO_SYMBOLS);

  // Fill any missing with v8 fallback
  for (const sym of MACRO_SYMBOLS) {
    if (prices[sym] == null) {
      const { price, change } = await fetchYahooV8Single(sym);
      if (price != null) { prices[sym] = price; changes[sym] = change; }
    }
  }

  const fmt  = (v, d=2) => v != null ? v.toFixed(d) : 'N/A';
  const fmtC = (v)      => v != null ? (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : 'N/A';

  return {
    sp500:       fmt(prices['^GSPC'], 2),
    sp500_chg:   fmtC(changes['^GSPC']),
    nasdaq:      fmt(prices['^IXIC'], 2),
    nasdaq_chg:  fmtC(changes['^IXIC']),
    vix:         fmt(prices['^VIX'], 2),
    tnx:         fmt(prices['^TNX'], 2),   // 10Y yield
    tyx:         fmt(prices['^TYX'], 2),   // 30Y yield
    irx:         fmt(prices['^IRX'], 2),   // 3M yield
    gld:         fmt(prices['GLD'],  2),
    gld_chg:     fmtC(changes['GLD']),
    tlt:         fmt(prices['TLT'],  2),
    tlt_chg:     fmtC(changes['TLT']),
    usd:         fmt(prices['DX-Y.NYB'], 2),
    usd_chg:     fmtC(changes['DX-Y.NYB']),
    btc:         prices['BTC-AUD'] != null ? Math.round(prices['BTC-AUD']).toLocaleString() : 'N/A',
    btc_chg:     fmtC(changes['BTC-AUD']),
    eth:         prices['ETH-AUD'] != null ? Math.round(prices['ETH-AUD']).toLocaleString() : 'N/A',
    eth_chg:     fmtC(changes['ETH-AUD']),
    sol:         fmt(prices['SOL-AUD'], 2),
    sol_chg:     fmtC(changes['SOL-AUD']),
    audusd:      fmt(prices['AUDUSD=X'], 4),
  };
}

function buildMacroPrompt(m) {
  return `You are a sharp macro analyst writing a morning briefing for a personal investment dashboard.

LIVE MARKET DATA:
- S&P 500: ${m.sp500} (${m.sp500_chg}% today)
- NASDAQ:  ${m.nasdaq} (${m.nasdaq_chg}% today)
- VIX (fear index): ${m.vix}
- 3M Treasury: ${m.irx}%  |  10Y Treasury: ${m.tnx}%  |  30Y Treasury: ${m.tyx}%
- Gold (GLD): $${m.gld} (${m.gld_chg}% today)
- 20Y Bond ETF (TLT): $${m.tlt} (${m.tlt_chg}% today)
- USD Index: ${m.usd} (${m.usd_chg}% today)
- Bitcoin: A$${m.btc} (${m.btc_chg}% today)
- Ethereum: A$${m.eth} (${m.eth_chg}% today)
- Solana: A$${m.sol} (${m.sol_chg}% today)
- AUD/USD: ${m.audusd}

PORTFOLIO CONTEXT: Heavy crypto portfolio — 63% crypto (SOL, ETH, DOGE, SUI), 37% US equities (AMZN). NAV A$13,082. Down -37.5% from cost basis of A$20,939. Max drawdown -74.6%. Sharpe 1.35.

Write a concise market intelligence briefing. Return ONLY valid JSON (no markdown, no code blocks) with this exact shape:
{
  "headline": "One-line regime summary, max 10 words",
  "sections": [
    {"icon": "monitoring",       "color": "#3fb950", "label": "EQUITIES",      "text": "2-3 sharp sentences on equity market conditions and outlook."},
    {"icon": "currency_bitcoin", "color": "#f0883e", "label": "CRYPTO",        "text": "2-3 sharp sentences focused on crypto conditions relevant to this portfolio."},
    {"icon": "account_balance",  "color": "#58a6ff", "label": "RATES & BONDS", "text": "2-3 sentences on rates, yield curve, bond market."},
    {"icon": "public",           "color": "#8b949e", "label": "MACRO & FX",    "text": "2-3 sentences on USD, AUD/USD, global macro conditions."}
  ]
}`;
}

/* ── Route handlers ─────────────────────────────────────────────────────── */

async function handlePrices(body, res) {
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
  const symbols = payload?.symbols;
  if (!Array.isArray(symbols) || !symbols.length) {
    res.writeHead(400, CORS); return res.end(JSON.stringify({ error: '`symbols` array required' }));
  }

  console.log(`[${new Date().toISOString()}] /api/prices — ${symbols.join(', ')}`);
  try {
    let { prices, changes } = await fetchYahooV7(symbols);
    const missing = symbols.filter(s => prices[s] == null);
    if (missing.length) {
      await Promise.all(missing.map(async s => {
        const { price, change } = await fetchYahooV8Single(s);
        if (price != null) { prices[s] = price; changes[s] = change; }
      }));
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ prices, changes }));
  } catch (err) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// /api/history — daily AUD closes via Yahoo v8 chart endpoint, used by the
// dashboard's period-return cards (1W/1M/3M/YTD/1Y).
function fetchYahooDaily(symbol, range = '1y') {
  return new Promise((resolve) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d)?.chart?.result?.[0];
          const ts = r?.timestamp || [];
          const closes = r?.indicators?.quote?.[0]?.close || [];
          const points = [];
          for (let i = 0; i < ts.length; i++) {
            if (closes[i] != null) points.push([ts[i] * 1000, closes[i]]);
          }
          resolve(points);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

async function handleHistory(body, res) {
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400, CORS); return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
  const symbols = payload?.symbols;
  if (!Array.isArray(symbols) || !symbols.length) {
    res.writeHead(400, CORS); return res.end(JSON.stringify({ error: '`symbols` array required' }));
  }
  console.log(`[${new Date().toISOString()}] /api/history — ${symbols.join(', ')}`);
  try {
    const series = {};
    const skipped = [];
    await Promise.all(symbols.map(async sym => {
      const points = await fetchYahooDaily(sym, '1y');
      if (points.length) series[sym] = points;
      else skipped.push(sym);
    }));
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ series, skipped: skipped.length ? skipped : undefined }));
  } catch (err) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleMacro(body, res) {
  let payload = {};
  try { payload = JSON.parse(body); } catch { /* body may be empty */ }

  const apiKey = payload?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.writeHead(400, CORS);
    return res.end(JSON.stringify({ error: 'No Anthropic API key. Set ANTHROPIC_API_KEY env var or pass { key: "..." } in body.' }));
  }

  console.log(`[${new Date().toISOString()}] /api/macro — fetching indicators + calling Claude...`);
  try {
    const macro  = await fetchMacroData();
    const prompt = buildMacroPrompt(macro);
    const result = await callClaude(prompt, apiKey);

    // Extract text from Claude response
    const raw  = result?.content?.[0]?.text || '';
    let briefing;
    try {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      briefing = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, return the raw text so the UI can display it
      briefing = { headline: 'Market briefing generated', sections: [{ icon: 'info', color: '#8b949e', label: 'BRIEFING', text: raw }] };
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({ briefing, indicators: macro }));
    console.log(`[${new Date().toISOString()}] /api/macro — done. Headline: "${briefing.headline}"`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] /api/macro error:`, err.message);
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: err.message }));
  }
}

/* ── HTTP server ────────────────────────────────────────────────────────── */

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ status: 'ok', port: PORT, anthropic: !!process.env.ANTHROPIC_API_KEY }));
  }

  // Serve index.html at the root so the dashboard can be opened in a real
  // browser (file:// breaks fetch CORS in some setups). Same-origin solves it.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('index.html not found: ' + e.message);
    }
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/api/prices')  return handlePrices(body, res);
      if (req.url === '/api/history') return handleHistory(body, res);
      if (req.url === '/api/macro')   return handleMacro(body, res);
      res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Not found' }));
    });
    return;
  }

  res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n  PortfolioOS Server  •  http://localhost:${PORT}`);
  console.log(`  POST /api/prices   •  POST /api/macro  •  GET /health`);
  console.log(`  Anthropic key: ${hasKey ? '✓ set via ANTHROPIC_API_KEY' : '✗ not set — export ANTHROPIC_API_KEY=sk-ant-... for AI macro'}\n`);
});
