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
