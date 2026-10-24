// Tickers the idea screener checks: liquid US stocks and ETFs with listed LEAPS, across price ranges.
export const UNIVERSE = [
  // under ~$30
  "SOFI", "F", "PFE", "T", "INTC", "NU", "RIVN", "HOOD", "SNAP", "CCL", "AAL", "MARA", "KVUE", "VZ", "WBD", "LCID", "CMCSA",
  // ~$30 to $120
  "BAC", "WFC", "C", "KO", "PYPL", "UBER", "DKNG", "RBLX", "OXY", "NKE", "SBUX", "DIS", "CSCO", "MU", "SCHW", "BMY", "MRK",
  "XOM", "PLTR", "SHOP", "ABNB", "DDOG", "NET", "XYZ", "COIN", "AMD", "QCOM", "TSM", "ORCL",
  // over ~$120
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "CRM", "ADBE", "NFLX", "JPM", "GS", "V", "MA", "COST",
  "WMT", "HD", "LLY", "UNH", "ABBV", "JNJ", "CVX", "CAT", "GE", "PANW", "CRWD",
  // ETFs
  "SPY", "QQQ", "IWM", "XLF", "XLE", "SMH",
];

// Names for instant ticker suggestions before the search service answers.
export const NAMES = {
  SOFI: "SoFi Technologies", F: "Ford Motor", PFE: "Pfizer", T: "AT&T", INTC: "Intel", NU: "Nu Holdings", RIVN: "Rivian Automotive",
  HOOD: "Robinhood Markets", SNAP: "Snap", CCL: "Carnival", AAL: "American Airlines", MARA: "MARA Holdings", KVUE: "Kenvue",
  VZ: "Verizon", WBD: "Warner Bros. Discovery", LCID: "Lucid Group", CMCSA: "Comcast", BAC: "Bank of America", WFC: "Wells Fargo",
  C: "Citigroup", KO: "Coca-Cola", PYPL: "PayPal", UBER: "Uber Technologies", DKNG: "DraftKings", RBLX: "Roblox",
  OXY: "Occidental Petroleum", NKE: "Nike", SBUX: "Starbucks", DIS: "Walt Disney", CSCO: "Cisco Systems", MU: "Micron Technology",
  SCHW: "Charles Schwab", BMY: "Bristol-Myers Squibb", MRK: "Merck", XOM: "Exxon Mobil", PLTR: "Palantir Technologies",
  SHOP: "Shopify", ABNB: "Airbnb", DDOG: "Datadog", NET: "Cloudflare", XYZ: "Block", COIN: "Coinbase", AMD: "Advanced Micro Devices",
  QCOM: "Qualcomm", TSM: "Taiwan Semiconductor", ORCL: "Oracle", AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet (Google)",
  AMZN: "Amazon", META: "Meta Platforms", NVDA: "NVIDIA", TSLA: "Tesla", AVGO: "Broadcom", CRM: "Salesforce", ADBE: "Adobe",
  NFLX: "Netflix", JPM: "JPMorgan Chase", GS: "Goldman Sachs", V: "Visa", MA: "Mastercard", COST: "Costco", WMT: "Walmart",
  HD: "Home Depot", LLY: "Eli Lilly", UNH: "UnitedHealth", ABBV: "AbbVie", JNJ: "Johnson & Johnson", CVX: "Chevron",
  CAT: "Caterpillar", GE: "GE Aerospace", PANW: "Palo Alto Networks", CRWD: "CrowdStrike", SPY: "SPDR S&P 500 ETF",
  QQQ: "Invesco QQQ (Nasdaq-100) ETF", IWM: "iShares Russell 2000 ETF", XLF: "Financial Select Sector SPDR", XLE: "Energy Select Sector SPDR",
  SMH: "VanEck Semiconductor ETF", SPX: "S&P 500 Index", NDX: "Nasdaq-100 Index", RUT: "Russell 2000 Index",
};
