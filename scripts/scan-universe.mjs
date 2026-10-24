// About 300 US stocks and ETFs with actively traded long-dated options, used by the nightly scan.
// Mostly large and mid caps from the S&P 500 and Nasdaq-100, plus popular high-volume names and sector ETFs.
export const SCAN_UNIVERSE = [
  // Mega and large cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM",
  "TXN", "IBM", "NOW", "INTU", "AMAT", "LRCX", "KLAC", "MU", "ADI", "MRVL", "NXPI", "ON", "MCHP", "SNPS", "CDNS",
  "PANW", "CRWD", "FTNT", "ZS", "NET", "DDOG", "SNOW", "MDB", "TEAM", "WDAY", "SHOP", "UBER", "LYFT", "ABNB", "DASH",
  "PLTR", "SMCI", "DELL", "HPQ", "HPE", "ANET", "ARM", "TSM", "ASML", "SNAP", "PINS", "RBLX", "U", "TWLO", "OKTA",
  "DOCU", "ZM", "ROKU", "SPOT", "NFLX", "EA", "TTWO", "EBAY", "ETSY", "PYPL", "XYZ", "COIN", "HOOD", "SOFI", "AFRM",
  "UPST", "MSTR", "MARA", "RIOT", "IONQ", "RKLB", "PATH", "AI", "SOUN", "APP", "CVNA", "DKNG", "GME", "AMC", "CHWY",
  // Communication and media
  "DIS", "CMCSA", "T", "VZ", "TMUS", "WBD", "CHTR", "GOOG",
  // Consumer
  "WMT", "COST", "TGT", "HD", "LOW", "NKE", "SBUX", "MCD", "CMG", "YUM", "LULU", "KO", "PEP", "PG", "CL", "KMB",
  "MDLZ", "KHC", "GIS", "HSY", "MO", "PM", "EL", "TJX", "ROST", "DG", "DLTR", "BBY", "KR", "CVS", "F", "GM",
  "RIVN", "LCID", "NIO", "XPEV", "LI", "TM", "HMC", "CCL", "RCL", "NCLH", "MAR", "HLT", "BKNG", "EXPE", "DAL", "UAL",
  "AAL", "LUV", "KVUE", "CROX", "DECK", "W", "BABA", "JD", "PDD", "BIDU", "MELI", "SE", "CPNG", "NU",
  // Financials
  "JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW", "BLK", "AXP", "V", "MA", "COF", "USB", "PNC", "TFC", "MET", "PRU",
  "AIG", "ALL", "PGR", "CB", "BX", "KKR", "APO", "ICE", "CME", "SPGI", "MCO", "BRK.B", "ALLY", "SYF", "KEY",
  // Healthcare
  "LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE", "BMY", "AMGN", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "BNTX", "ABT",
  "TMO", "DHR", "ISRG", "SYK", "MDT", "BSX", "ZTS", "CI", "ELV", "HUM", "CNC", "HCA", "TDOC", "NVO", "AZN", "HIMS",
  // Energy and materials
  "XOM", "CVX", "COP", "OXY", "SLB", "HAL", "EOG", "DVN", "MPC", "VLO", "PSX", "FANG", "APA", "BP", "SHEL", "KMI",
  "WMB", "ENPH", "FSLR", "SEDG", "PLUG", "FCX", "NEM", "AA", "CLF", "NUE", "DOW", "LIN", "MOS", "ALB",
  // Industrials
  "BA", "CAT", "DE", "GE", "HON", "MMM", "UPS", "FDX", "LMT", "RTX", "NOC", "GD", "UNP", "CSX", "NSC", "EMR",
  "ETN", "PH", "ITW", "WM", "JCI", "CARR", "GEV", "VRT", "URI", "PCAR", "JOBY", "ACHR",
  // Utilities and real estate
  "NEE", "DUK", "SO", "D", "AEP", "EXC", "PCG", "VST", "CEG", "AMT", "PLD", "CCI", "O", "SPG", "EQIX",
  // ETFs
  "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC", "SMH",
  "SOXX", "XBI", "IBB", "KRE", "XHB", "XRT", "GDX", "GDXJ", "SLV", "GLD", "USO", "TLT", "HYG", "EEM", "EFA", "FXI",
  "EWZ", "ARKK",
];
