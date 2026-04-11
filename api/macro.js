/**
 * Vercel Serverless Function — /api/macro
 * POST { categories?: string[], briefing?: boolean } → { instruments, regime, briefing? }
 *
 * Tiered global macro universe — ~170 instruments across 10 categories.
 * Data sources: Finnhub (equities + ETFs + FX), CoinGecko (crypto).
 *
 * Request body:
 *   categories: array of category keys to fetch. If omitted, defaults to ['tier1'].
 *               'all' fetches every category.
 *   briefing:   if true AND tier1 data is loaded, generates AI briefing.
 */
const https = require('https');

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ---------- UNIVERSE: ~170 instruments ----------
// Each instrument has: name, category, source, id (finnhub symbol or coingecko id)
// Categories: tier1, indices-global, sectors-us, defence, pharma-healthcare,
//             infrastructure, resources-commodities, fixed-income, fx, crypto,
//             volatility, semis-ai, emerging-markets
const UNIVERSE = {
  // ========== TIER 1: Core always-on (20) ==========
  'SPY':    { name: 'S&P 500 (SPY)',            category: 'tier1', source: 'finnhub' },
  'QQQ':    { name: 'Nasdaq 100 (QQQ)',         category: 'tier1', source: 'finnhub' },
  'DIA':    { name: 'Dow Jones (DIA)',          category: 'tier1', source: 'finnhub' },
  'IWM':    { name: 'Russell 2000 (IWM)',       category: 'tier1', source: 'finnhub' },
  'VIXY':   { name: 'VIX Short-Term Futures',   category: 'tier1', source: 'finnhub' },
  'TLT':    { name: '20Y Treasury (TLT)',       category: 'tier1', source: 'finnhub' },
  'IEF':    { name: '10Y Treasury (IEF)',       category: 'tier1', source: 'finnhub' },
  'SHY':    { name: '2Y Treasury (SHY)',        category: 'tier1', source: 'finnhub' },
  'HYG':    { name: 'High Yield Credit (HYG)',  category: 'tier1', source: 'finnhub' },
  'UUP':    { name: 'US Dollar Index (UUP)',    category: 'tier1', source: 'finnhub' },
  'GLD':    { name: 'Gold (GLD)',               category: 'tier1', source: 'finnhub' },
  'USO':    { name: 'WTI Crude Oil (USO)',      category: 'tier1', source: 'finnhub' },
  'CPER':   { name: 'Copper (CPER)',            category: 'tier1', source: 'finnhub' },
  'EEM':    { name: 'Emerging Markets (EEM)',   category: 'tier1', source: 'finnhub' },
  'EWJ':    { name: 'Japan (EWJ)',              category: 'tier1', source: 'finnhub' },
  'EWA':    { name: 'Australia (EWA)',          category: 'tier1', source: 'finnhub' },
  'XLK':    { name: 'US Tech (XLK)',            category: 'tier1', source: 'finnhub' },
  'XLF':    { name: 'US Financials (XLF)',      category: 'tier1', source: 'finnhub' },
  'XLE':    { name: 'US Energy (XLE)',          category: 'tier1', source: 'finnhub' },
  'bitcoin':  { name: 'Bitcoin (BTC)',  category: 'tier1', source: 'coingecko', id: 'bitcoin' },

  // ========== INDICES GLOBAL (17) ==========
  'EWU':    { name: 'UK FTSE 100',              category: 'indices-global', source: 'finnhub' },
  'EWG':    { name: 'Germany DAX',              category: 'indices-global', source: 'finnhub' },
  'EWQ':    { name: 'France CAC 40',            category: 'indices-global', source: 'finnhub' },
  'FEZ':    { name: 'Euro Stoxx 50',            category: 'indices-global', source: 'finnhub' },
  'EWI':    { name: 'Italy FTSE MIB',           category: 'indices-global', source: 'finnhub' },
  'EWP':    { name: 'Spain IBEX',               category: 'indices-global', source: 'finnhub' },
  'EWL':    { name: 'Switzerland SMI',          category: 'indices-global', source: 'finnhub' },
  'EWN':    { name: 'Netherlands AEX',          category: 'indices-global', source: 'finnhub' },
  'FXI':    { name: 'China Large Cap',          category: 'indices-global', source: 'finnhub' },
  'INDA':   { name: 'India Nifty 50',           category: 'indices-global', source: 'finnhub' },
  'EWY':    { name: 'Korea KOSPI',              category: 'indices-global', source: 'finnhub' },
  'EWT':    { name: 'Taiwan',                   category: 'indices-global', source: 'finnhub' },
  'EWH':    { name: 'Hong Kong',                category: 'indices-global', source: 'finnhub' },
  'EWS':    { name: 'Singapore',                category: 'indices-global', source: 'finnhub' },
  'EWC':    { name: 'Canada TSX',               category: 'indices-global', source: 'finnhub' },
  'EWZ':    { name: 'Brazil Bovespa',           category: 'indices-global', source: 'finnhub' },
  'EWW':    { name: 'Mexico IPC',               category: 'indices-global', source: 'finnhub' },

  // ========== US SECTORS (8 more beyond tier1) ==========
  'XLV':    { name: 'US Healthcare',            category: 'sectors-us', source: 'finnhub' },
  'XLI':    { name: 'US Industrials',           category: 'sectors-us', source: 'finnhub' },
  'XLY':    { name: 'US Consumer Discretionary', category: 'sectors-us', source: 'finnhub' },
  'XLP':    { name: 'US Consumer Staples',      category: 'sectors-us', source: 'finnhub' },
  'XLU':    { name: 'US Utilities',             category: 'sectors-us', source: 'finnhub' },
  'XLB':    { name: 'US Materials',             category: 'sectors-us', source: 'finnhub' },
  'XLRE':   { name: 'US Real Estate',           category: 'sectors-us', source: 'finnhub' },
  'XLC':    { name: 'US Communication',         category: 'sectors-us', source: 'finnhub' },

  // ========== DEFENCE & AEROSPACE (8) ==========
  'ITA':    { name: 'US Aerospace & Defence (ITA)', category: 'defence', source: 'finnhub' },
  'XAR':    { name: 'Aerospace & Defence Equal Weight (XAR)', category: 'defence', source: 'finnhub' },
  'PPA':    { name: 'Aerospace & Defence (PPA)', category: 'defence', source: 'finnhub' },
  'LMT':    { name: 'Lockheed Martin',          category: 'defence', source: 'finnhub' },
  'RTX':    { name: 'Raytheon Technologies',    category: 'defence', source: 'finnhub' },
  'NOC':    { name: 'Northrop Grumman',         category: 'defence', source: 'finnhub' },
  'GD':     { name: 'General Dynamics',         category: 'defence', source: 'finnhub' },
  'BA':     { name: 'Boeing',                   category: 'defence', source: 'finnhub' },

  // ========== PHARMA & HEALTHCARE (9) ==========
  'IBB':    { name: 'Biotech (IBB)',            category: 'pharma-healthcare', source: 'finnhub' },
  'XBI':    { name: 'Biotech Small Cap (XBI)',  category: 'pharma-healthcare', source: 'finnhub' },
  'IHI':    { name: 'Medical Devices (IHI)',    category: 'pharma-healthcare', source: 'finnhub' },
  'PPH':    { name: 'Pharma (PPH)',             category: 'pharma-healthcare', source: 'finnhub' },
  'XPH':    { name: 'Pharma Alt (XPH)',         category: 'pharma-healthcare', source: 'finnhub' },
  'IHF':    { name: 'Healthcare Services (IHF)', category: 'pharma-healthcare', source: 'finnhub' },
  'LLY':    { name: 'Eli Lilly',                category: 'pharma-healthcare', source: 'finnhub' },
  'JNJ':    { name: 'Johnson & Johnson',        category: 'pharma-healthcare', source: 'finnhub' },
  'PFE':    { name: 'Pfizer',                   category: 'pharma-healthcare', source: 'finnhub' },

  // ========== INFRASTRUCTURE (8) ==========
  'PAVE':   { name: 'US Infrastructure (PAVE)', category: 'infrastructure', source: 'finnhub' },
  'IFRA':   { name: 'US Infrastructure Alt (IFRA)', category: 'infrastructure', source: 'finnhub' },
  'GII':    { name: 'Global Infrastructure (GII)', category: 'infrastructure', source: 'finnhub' },
  'IGF':    { name: 'Global Infra Alt (IGF)',   category: 'infrastructure', source: 'finnhub' },
  'IYT':    { name: 'Transports (IYT)',         category: 'infrastructure', source: 'finnhub' },
  'JETS':   { name: 'Airlines (JETS)',          category: 'infrastructure', source: 'finnhub' },
  'SEA':    { name: 'Shipping (SEA)',           category: 'infrastructure', source: 'finnhub' },
  'NEE':    { name: 'NextEra Energy',           category: 'infrastructure', source: 'finnhub' },

  // ========== RESOURCES & COMMODITIES (20) ==========
  'SLV':    { name: 'Silver (SLV)',             category: 'resources-commodities', source: 'finnhub' },
  'PPLT':   { name: 'Platinum (PPLT)',          category: 'resources-commodities', source: 'finnhub' },
  'PALL':   { name: 'Palladium (PALL)',         category: 'resources-commodities', source: 'finnhub' },
  'UNG':    { name: 'Natural Gas (UNG)',        category: 'resources-commodities', source: 'finnhub' },
  'UGA':    { name: 'Gasoline (UGA)',           category: 'resources-commodities', source: 'finnhub' },
  'BNO':    { name: 'Brent Crude (BNO)',        category: 'resources-commodities', source: 'finnhub' },
  'URA':    { name: 'Uranium (URA)',            category: 'resources-commodities', source: 'finnhub' },
  'NLR':    { name: 'Nuclear (NLR)',            category: 'resources-commodities', source: 'finnhub' },
  'LIT':    { name: 'Lithium & Battery (LIT)',  category: 'resources-commodities', source: 'finnhub' },
  'REMX':   { name: 'Rare Earth (REMX)',        category: 'resources-commodities', source: 'finnhub' },
  'GDX':    { name: 'Gold Miners (GDX)',        category: 'resources-commodities', source: 'finnhub' },
  'GDXJ':   { name: 'Junior Gold Miners (GDXJ)', category: 'resources-commodities', source: 'finnhub' },
  'SIL':    { name: 'Silver Miners (SIL)',      category: 'resources-commodities', source: 'finnhub' },
  'COPX':   { name: 'Copper Miners (COPX)',     category: 'resources-commodities', source: 'finnhub' },
  'XME':    { name: 'Metals & Mining (XME)',    category: 'resources-commodities', source: 'finnhub' },
  'DBA':    { name: 'Agriculture (DBA)',        category: 'resources-commodities', source: 'finnhub' },
  'CORN':   { name: 'Corn (CORN)',              category: 'resources-commodities', source: 'finnhub' },
  'WEAT':   { name: 'Wheat (WEAT)',             category: 'resources-commodities', source: 'finnhub' },
  'CANE':   { name: 'Sugar (CANE)',             category: 'resources-commodities', source: 'finnhub' },
  'DBC':    { name: 'Broad Commodities (DBC)',  category: 'resources-commodities', source: 'finnhub' },

  // ========== FIXED INCOME (9 more beyond tier1) ==========
  'TLH':    { name: '10-20Y Treasury (TLH)',    category: 'fixed-income', source: 'finnhub' },
  'SHV':    { name: 'Short Treasury (SHV)',     category: 'fixed-income', source: 'finnhub' },
  'TIP':    { name: 'TIPS (TIP)',               category: 'fixed-income', source: 'finnhub' },
  'LQD':    { name: 'Investment Grade Corp (LQD)', category: 'fixed-income', source: 'finnhub' },
  'JNK':    { name: 'High Yield Alt (JNK)',     category: 'fixed-income', source: 'finnhub' },
  'EMB':    { name: 'EM Sovereign (EMB)',       category: 'fixed-income', source: 'finnhub' },
  'EMHY':   { name: 'EM High Yield (EMHY)',     category: 'fixed-income', source: 'finnhub' },
  'BKLN':   { name: 'Leveraged Loans (BKLN)',   category: 'fixed-income', source: 'finnhub' },
  'BWX':    { name: 'Global ex-US Bonds (BWX)', category: 'fixed-income', source: 'finnhub' },

  // ========== FX (12) ==========
  'OANDA:EUR_USD':  { name: 'EUR/USD',          category: 'fx', source: 'finnhub' },
  'OANDA:GBP_USD':  { name: 'GBP/USD',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_JPY':  { name: 'USD/JPY',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_CHF':  { name: 'USD/CHF',          category: 'fx', source: 'finnhub' },
  'OANDA:AUD_USD':  { name: 'AUD/USD',          category: 'fx', source: 'finnhub' },
  'OANDA:NZD_USD':  { name: 'NZD/USD',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_CAD':  { name: 'USD/CAD',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_CNH':  { name: 'USD/CNH',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_INR':  { name: 'USD/INR',          category: 'fx', source: 'finnhub' },
  'OANDA:USD_MXN':  { name: 'USD/MXN',          category: 'fx', source: 'finnhub' },
  'OANDA:EUR_GBP':  { name: 'EUR/GBP',          category: 'fx', source: 'finnhub' },
  'OANDA:EUR_JPY':  { name: 'EUR/JPY',          category: 'fx', source: 'finnhub' },

  // ========== CRYPTO (6 more beyond tier1) ==========
  'ethereum':    { name: 'Ethereum (ETH)',      category: 'crypto', source: 'coingecko', id: 'ethereum' },
  'solana':      { name: 'Solana (SOL)',        category: 'crypto', source: 'coingecko', id: 'solana' },
  'binancecoin': { name: 'BNB',                 category: 'crypto', source: 'coingecko', id: 'binancecoin' },
  'ripple':      { name: 'XRP',                 category: 'crypto', source: 'coingecko', id: 'ripple' },
  'cardano':     { name: 'Cardano (ADA)',       category: 'crypto', source: 'coingecko', id: 'cardano' },
  'chainlink':   { name: 'Chainlink (LINK)',    category: 'crypto', source: 'coingecko', id: 'chainlink' },

  // ========== VOLATILITY & RISK (5) ==========
  'VXX':    { name: 'VIX Futures (VXX)',        category: 'volatility', source: 'finnhub' },
  'UVXY':   { name: 'VIX 2x Leveraged (UVXY)',  category: 'volatility', source: 'finnhub' },
  'SVXY':   { name: 'Short VIX (SVXY)',         category: 'volatility', source: 'finnhub' },
  'SQQQ':   { name: 'Nasdaq -3x (SQQQ)',        category: 'volatility', source: 'finnhub' },
  'SH':     { name: 'S&P 500 Inverse (SH)',     category: 'volatility', source: 'finnhub' },

  // ========== SEMIS & AI (8) ==========
  'SMH':    { name: 'Semis (SMH)',              category: 'semis-ai', source: 'finnhub' },
  'SOXX':   { name: 'Semis Alt (SOXX)',         category: 'semis-ai', source: 'finnhub' },
  'NVDA':   { name: 'Nvidia',                   category: 'semis-ai', source: 'finnhub' },
  'TSM':    { name: 'Taiwan Semiconductor',     category: 'semis-ai', source: 'finnhub' },
  'AMD':    { name: 'Advanced Micro Devices',   category: 'semis-ai', source: 'finnhub' },
  'AVGO':   { name: 'Broadcom',                 category: 'semis-ai', source: 'finnhub' },
  'MU':     { name: 'Micron Technology',        category: 'semis-ai', source: 'finnhub' },
  'BOTZ':   { name: 'Robotics & AI (BOTZ)',     category: 'semis-ai', source: 'finnhub' },
};

// ---------- HTTP helper ----------
function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PortfolioOS/1.0', 'Accept': 'application/json', ...headers }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchFinnhubQuote(symbol) {
  if (!FINNHUB_KEY) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  try {
    const data = await fetchJSON(url);
    if (data && typeof data.c === 'number' && data.c > 0) {
      return { price: data.c, changePct: data.dp ?? null, prevClose: data.pc };
    }
  } catch { /* swallow */ }
  return null;
}

async function fetchCoinGeckoBatch(ids, vs = 'aud') {
  if (!ids.length) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}&include_24hr_change=true`;
  try { return await fetchJSON(url); } catch { return {}; }
}

// ---------- Regime detection ----------
function detectRegime(instruments) {
  // Score based on VIX proxy (VIXY), SPY change, TLT change (inverse yields), HYG change, UUP change
  const get = (sym) => instruments[sym];
  const vixy = get('VIXY');
  const spy  = get('SPY');
  const hyg  = get('HYG');
  const uup  = get('UUP');
  const tlt  = get('TLT');

  let score = 0;
  // VIX direction: if VIXY is down hard, vol is falling → risk-on
  if (vixy?.changePct != null) {
    if (vixy.changePct < -2) score += 2;
    else if (vixy.changePct < 0) score += 1;
    else if (vixy.changePct > 2) score -= 2;
    else if (vixy.changePct > 0) score -= 1;
  }
  if (spy?.changePct != null) {
    if (spy.changePct > 0.5) score += 1;
    if (spy.changePct < -0.5) score -= 1;
  }
  if (hyg?.changePct != null) {
    if (hyg.changePct > 0) score += 1;
    if (hyg.changePct < -0.3) score -= 1;
  }
  if (uup?.changePct != null) {
    if (uup.changePct < -0.3) score += 1;  // weak dollar → risk-on
    if (uup.changePct > 0.3) score -= 1;
  }

  if (score >= 3) return 'RISK-ON';
  if (score <= -2) return 'RISK-OFF';
  return 'CHOPPY';
}

// ---------- Briefing (Claude) ----------
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildBriefingPrompt(instruments, regime) {
  // Pick the signals to pass to Claude — pass RAW data but instruct
  // it NOT to repeat any numbers.
  const top = Object.entries(instruments)
    .filter(([k, v]) => v && v.changePct != null)
    .sort((a, b) => Math.abs(b[1].changePct) - Math.abs(a[1].changePct))
    .slice(0, 8)
    .map(([k, v]) => `${UNIVERSE[k]?.name || k}: ${v.changePct.toFixed(2)}%`);

  const signals = [];
  const s = (key, label) => {
    const v = instruments[key]?.changePct;
    if (v != null) signals.push(`${label}: ${v.toFixed(2)}%`);
  };
  s('SPY', 'SPY');
  s('QQQ', 'QQQ');
  s('VIXY', 'VIX proxy');
  s('TLT', 'TLT (long bonds)');
  s('HYG', 'HYG (credit)');
  s('UUP', 'UUP (dollar)');
  s('GLD', 'Gold');
  s('USO', 'Oil');
  s('XLK', 'US Tech');
  s('XLF', 'US Financials');
  s('XLE', 'US Energy');
  s('bitcoin', 'BTC');

  return `You are a senior global macro strategist writing a morning desk note for a single portfolio manager. The dashboard already displays every live price and percentage on screen — DO NOT REPEAT ANY NUMBERS, PRICES, OR PERCENTAGES in your output. Your value is narrative and synthesis, not data regurgitation.

PORTFOLIO CONTEXT (this is the user you are writing for):
- ~48% Solana (SOL) — core crypto L1 conviction
- ~25% Ethereum (ETH) — core crypto L1 conviction
- ~16% Amazon (AMZN) — only equity, AWS/AI thesis
- ~6% Dogecoin (DOGE) — speculative meme
- ~5% Sui (SUI) — satellite L1 bet
- <1% Pudgy Penguins (PENGU) — broken speculative
- Zero cash buffer. Book is AUD-denominated.
- Total ~A$26k, ~82% crypto / 18% US mega-cap tech
- Conviction high on SOL/ETH/AMZN, speculative on the rest

CURRENT INTERNAL REGIME READ: ${regime}

INTERNAL SIGNAL SNAPSHOT (do not echo these numbers in your output):
${signals.join('\n')}

TOP ABSOLUTE MOVERS TODAY (do not echo numbers):
${top.join('\n')}

YOUR JOB — write 4 tight paragraphs (~150 words total):

PARAGRAPH 1 — THE STORY: What is actually driving markets right now? Name the catalyst — a Fed speech, an inflation print, an earnings theme, a geopolitical event, a positioning unwind. Be specific and current. Do NOT say "markets are risk-on/off" without substance.

PARAGRAPH 2 — MOVERS & THEMES BENEATH THE SURFACE: Call out what's ripping or breaking that is NOT already on the main dashboard cards. Sector leadership, commodity moves, credit under stress, themes like AI infra, defence rotation, energy capex. Name specific sectors/themes, not generic "equities are up."

PARAGRAPH 3 — WHAT THIS MEANS FOR YOUR PORTFOLIO (the most important paragraph): Link the macro read DIRECTLY to the user's six holdings. If rates are falling say "constructive for AMZN duration multiple." If the dollar weakens say "tailwind to AUD-denominated crypto book." If risk appetite is fading say "SOL's high-beta profile gets hit first." Name specific holdings and what the current environment does to each one. This paragraph is what the user actually came here for.

PARAGRAPH 4 — ONE THING TO WATCH IN NEXT 24-48 HRS: A specific named event, data release, earnings print, or price level. Not "watch the Fed." Something like "Thursday 8:30am CPI print — a >0.3% MoM core surprise would force a hawkish repricing that hits SOL/ETH hardest given their duration-like sensitivity to real rates."

STYLE RULES:
- Dense, specific, opinionated. Write like Zoltan Pozsar or Matt King — not a chatbot.
- No bullet points. No headers. Four flowing paragraphs of prose.
- No hedging words ("could," "may," "perhaps," "might").
- No generic clichés ("risk-on/risk-off" without substance).
- No mention of "analyzing" or "looking at" — just write the note.
- Absolutely no prices, percentages, or raw numbers.

Return ONLY valid JSON (no markdown fence):
{"headline":"one sharp opinionated line max 12 words","story":"paragraph 1","movers":"paragraph 2","forMe":"paragraph 3 linking to portfolio","watch":"paragraph 4 with specific event"}`;
}

// ---------- Main handler ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const categories = Array.isArray(body.categories) && body.categories.length
    ? body.categories
    : ['tier1'];
  const wantBriefing = body.briefing === true;

  // Determine which universe entries to fetch
  const keys = Object.keys(UNIVERSE).filter(k => {
    if (categories.includes('all')) return true;
    return categories.includes(UNIVERSE[k].category);
  });

  // Split by source
  const finnhubSyms = [];
  const coingeckoIds = [];
  const cgKeyToId = {};
  keys.forEach(k => {
    const u = UNIVERSE[k];
    if (u.source === 'finnhub') finnhubSyms.push(k);
    else if (u.source === 'coingecko') {
      coingeckoIds.push(u.id);
      cgKeyToId[k] = u.id;
    }
  });

  // Fetch Finnhub (parallel, limit concurrency to 30)
  const instruments = {};
  const batchSize = 30;
  for (let i = 0; i < finnhubSyms.length; i += batchSize) {
    const batch = finnhubSyms.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async sym => {
      const q = await fetchFinnhubQuote(sym);
      return [sym, q];
    }));
    results.forEach(([sym, q]) => {
      if (q) instruments[sym] = { price: q.price, changePct: q.changePct, prevClose: q.prevClose, name: UNIVERSE[sym].name, category: UNIVERSE[sym].category };
    });
  }

  // Fetch CoinGecko (one batch)
  if (coingeckoIds.length) {
    const cgData = await fetchCoinGeckoBatch([...new Set(coingeckoIds)], 'aud');
    for (const k of keys) {
      const id = cgKeyToId[k];
      if (id && cgData[id]) {
        instruments[k] = {
          price: cgData[id].aud,
          changePct: cgData[id].aud_24h_change ?? null,
          name: UNIVERSE[k].name,
          category: UNIVERSE[k].category,
        };
      }
    }
  }

  // Regime from tier1 if present
  const regime = detectRegime(instruments);

  // Briefing — only if requested, key available, and we have tier1 data
  let briefing = null, briefingError = null;
  if (wantBriefing) {
    if (!ANTHROPIC_KEY) {
      briefingError = 'ANTHROPIC_API_KEY not set in Vercel environment variables';
    } else if (!instruments.SPY && !instruments.bitcoin) {
      briefingError = 'Insufficient signal data for briefing';
    } else {
      try {
        const prompt = buildBriefingPrompt(instruments, regime);
        const result = await callClaude(prompt);
        if (result?.type === 'error' || !result?.content) {
          briefingError = result?.error?.message || 'Claude API error';
        } else {
          const raw = result.content?.[0]?.text || '';
          try {
            briefing = JSON.parse(raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim());
          } catch (e) {
            briefingError = 'Failed to parse briefing JSON';
          }
        }
      } catch (e) {
        briefingError = e.message;
      }
    }
  }

  // Category metadata for UI
  const categoryMeta = {
    'tier1':                { label: 'CORE (Tier 1)',       count: Object.values(UNIVERSE).filter(u => u.category === 'tier1').length },
    'indices-global':       { label: 'Global Indices',      count: Object.values(UNIVERSE).filter(u => u.category === 'indices-global').length },
    'sectors-us':           { label: 'US Sectors',          count: Object.values(UNIVERSE).filter(u => u.category === 'sectors-us').length },
    'defence':              { label: 'Defence & Aerospace', count: Object.values(UNIVERSE).filter(u => u.category === 'defence').length },
    'pharma-healthcare':    { label: 'Pharma & Healthcare', count: Object.values(UNIVERSE).filter(u => u.category === 'pharma-healthcare').length },
    'infrastructure':       { label: 'Infrastructure',      count: Object.values(UNIVERSE).filter(u => u.category === 'infrastructure').length },
    'resources-commodities': { label: 'Resources & Commodities', count: Object.values(UNIVERSE).filter(u => u.category === 'resources-commodities').length },
    'fixed-income':         { label: 'Fixed Income',        count: Object.values(UNIVERSE).filter(u => u.category === 'fixed-income').length },
    'fx':                   { label: 'FX',                  count: Object.values(UNIVERSE).filter(u => u.category === 'fx').length },
    'crypto':               { label: 'Crypto',              count: Object.values(UNIVERSE).filter(u => u.category === 'crypto').length },
    'volatility':           { label: 'Volatility & Hedges', count: Object.values(UNIVERSE).filter(u => u.category === 'volatility').length },
    'semis-ai':             { label: 'Semis & AI',          count: Object.values(UNIVERSE).filter(u => u.category === 'semis-ai').length },
  };

  res.status(200).json({
    regime,
    instruments,
    categoriesRequested: categories,
    categoryMeta,
    totalInUniverse: Object.keys(UNIVERSE).length,
    briefing,
    briefingError,
    _meta: {
      finnhubConfigured: !!FINNHUB_KEY,
      anthropicConfigured: !!ANTHROPIC_KEY,
      fetched: Object.keys(instruments).length,
      requested: keys.length,
    },
  });
};
