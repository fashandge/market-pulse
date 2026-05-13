"""Assemble market overview data from scraped watchlist and ticker.csv themes."""

from __future__ import annotations

OVERVIEW_GROUPS = [
    ("Major Indices", ["NDX", "QQQ", "SPX", "SPY", "RSP", "DJI", "NYA", "IWM"]),
    ("Other Indices", ["VIX", "VIX3M", "US10Y", "US20Y", "US30Y", "TLT", "DXY", "CL1!"]),
    ("Futures", ["NQ1!", "ES1!", "RTY1!"]),
    ("Gold / Silver / Copper", ["GOLD", "GLD", "GC1!", "GVZ", "GDX", "SILVER", "SLV", "VXSLV", "SIL", "SLVR", "COPX"]),
    ("Crypto", ["BTCUSD", "IBIT", "DVOL", "ETHUSD", "ETHA", "ETHDVOL", "ETHU", "CRCL"]),
    ("Critical Sectors", ["SMH", "DRAM", "AIPO", "URA", "IGV", "OIH", "XLF", "XBI", "ITA"]),
    ("Other ETFs", ["GRID", "PAVE", "CHAT", "AIQ"]),
]

GROUPS_AVG_OVERRIDE: dict[str, dict] = {
    "Memory & Storage": {
        "avg_symbols": ["MU", "SNDK", "WDC", "P"],
        "avg_note": "Avg computed for US stocks only",
    },
    "Semicon Equipment": {
        "avg_symbols": ["LRCX", "AMAT", "KLAC", "TER", "FORM"],
        "avg_note": "Avg computed for US stocks only",
    },
    "Data Center Power": {
        "avg_symbols": ["BE", "VRT", "GEV", "ETN", "POWL", "CPSH", "PWR", "HUBB", "HPS.A"],
        "avg_note": "Avg computed for US/CA stocks only",
    },
}

CRITICAL_THEME_GROUPS = [
    ("Big Tech", ["NVDA", "GOOGL", "AAPL", "MSFT", "AMZN", "META", "TSLA"]),
    ("Memory & Storage", ["MU", "SNDK", "WDC", "P", "000660", "005930"]),
    ("Networking & Optical", ["LITE", "COHR", "GLW", "CIEN", "ANET", "NOK", "VIAV", "LWLG", "AXTI"]),
    ("AI Chips & Foundry", ["NVDA", "AMD", "INTC", "TSM", "MRVL", "QCOM", "ARM"]),
    ("Data Center Power", ["BE", "VRT", "GEV", "ETN", "POWL", "CPSH", "PWR", "HUBB", "HPS.A", "SU", "ENR"]),
    ("BTC Mining & GPU Cloud", ["IREN", "CIFR", "NBIS", "CRWV", "CLSK", "HUT"]),
    ("Semicon Equipment", ["LRCX", "AMAT", "KLAC", "TER", "FORM", "6857"]),
    ("Clean Energy", ["MP", "USAR", "BHP"]),
    ("Nuclear & Uranium", ["CCJ", "LEU", "UUUU", "NLR", "URA"]),
]

OTHER_THEME_GROUPS = [
    ("Enterprise SaaS", ["ORCL", "OKTA"]),
    ("Consumer Tech", ["HOOD", "DASH", "APP", "RDDT", "GRMN"]),
    ("Pharma & Biotech", ["JNJ", "MRK", "KRYS", "LLY", "TARS", "GILD", "LIFE"]),
    ("Industrial & Infra", ["CRML", "ROK", "CAT", "SEI", "FLR", "STRL", "FLEX"]),
    ("Utilities", ["NEE", "PPL", "VST", "FE"]),
    ("Oil & Gas", ["OCO", "XOM", "BKR"]),
    ("AI Software", ["PLTR", "PATH", "TEM"]),
    ("Cybersecurity", ["CRWD", "PANW", "FTNT"]),
    ("Hospitality", ["HLT", "HTHT"]),
    ("Defense", ["LMT", "KTOS", "ITA"]),
]

SECTIONS = [
    ("Overview", OVERVIEW_GROUPS, False),
    ("Critical Themes", CRITICAL_THEME_GROUPS, True),
    ("Other Themes", OTHER_THEME_GROUPS, True),
]


def _parse_volume(vol_str: str) -> float | None:
    if not vol_str or vol_str == "—":
        return None
    s = vol_str.strip()
    multipliers = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3}
    for suffix, mult in multipliers.items():
        if s.endswith(suffix):
            try:
                return float(s[:-1].strip()) * mult
            except ValueError:
                return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _compute_avg_vol_ratio(symbols: list[str], data: dict) -> float | None:
    ratios = []
    for s in symbols:
        d = data.get(s)
        if not d:
            continue
        vol = _parse_volume(d.get("volume", ""))
        avg_vol = _parse_volume(d.get("avg_volume", ""))
        if vol is not None and avg_vol is not None and avg_vol > 0:
            ratios.append(vol / avg_vol)
    if not ratios:
        return None
    return round(sum(ratios) / len(ratios), 2)


def _compute_avg_change(symbols: list[str], data: dict) -> float | None:
    values = [
        data[s]["change_pct_float"]
        for s in symbols
        if s in data and data[s].get("change_pct_float") is not None
    ]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def build_overview(scraped_data: dict) -> list[dict]:
    sections = []
    for section_name, groups_def, show_avg in SECTIONS:
        groups = []
        for group_name, symbols in groups_def:
            override = GROUPS_AVG_OVERRIDE.get(group_name, {})
            avg_symbols = override.get("avg_symbols", symbols)
            avg_change = _compute_avg_change(avg_symbols, scraped_data) if show_avg else None
            avg_note = override.get("avg_note", "") if show_avg else ""
            tickers = []
            for sym in symbols:
                d = scraped_data.get(sym)
                if d:
                    tickers.append({
                        "symbol": sym,
                        "price": d["price"],
                        "change_pct": d["change_pct"],
                        "change_abs": d.get("change_abs", ""),
                        "volume": d["volume"],
                        "avg_volume": d["avg_volume"],
                        "formal_symbol": d.get("formal_symbol", sym),
                    })
                else:
                    tickers.append({
                        "symbol": sym,
                        "price": "—",
                        "change_pct": "—",
                        "change_abs": "",
                        "volume": "",
                        "avg_volume": "",
                        "formal_symbol": sym,
                    })
            avg_vol_ratio = _compute_avg_vol_ratio(avg_symbols, scraped_data) if show_avg else None
            group_data: dict = {
                "name": group_name,
                "avg_change": avg_change,
                "tickers": tickers,
            }
            if avg_vol_ratio is not None:
                group_data["avg_vol_ratio"] = avg_vol_ratio
            if avg_note:
                group_data["avg_note"] = avg_note
            groups.append(group_data)
        sections.append({"name": section_name, "groups": groups})
    return sections
