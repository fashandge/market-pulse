"""Assemble market overview data from scraped watchlist and ticker.csv themes."""

from __future__ import annotations

import csv
from pathlib import Path

TICKER_CSV = Path.home() / "projects/stock_picker/data/ticker.csv"

SECTIONS = [
    ("Overview", False, [
        "Major Indices", "Other Indices", "Futures",
        "Gold / Silver / Copper", "Crypto",
        "Critical Sectors", "Other ETFs",
    ]),
    ("Critical Themes", True, [
        "Big Tech", "Memory & Storage", "Networking & Optical",
        "AI Chips & Foundry", "Data Center Power", "BTC Mining & GPU Cloud",
        "Semicon Equipment", "Clean Energy", "Nuclear & Uranium",
    ]),
    ("Other Themes", True, [
        "Enterprise SaaS", "Consumer Tech", "Pharma & Biotech",
        "Industrial & Infra", "Utilities", "Oil & Gas",
        "AI Software", "Cybersecurity", "Hospitality", "Defense",
    ]),
]

GROUPS_AVG_OVERRIDE: dict[str, dict] = {
    "Memory & Storage": {
        "avg_symbols": ["MU", "SNDK", "WDC", "P"],
        "avg_note": "Avg computed for US stocks only",
    },
    "Semicon Equipment": {
        "avg_symbols": ["LRCX", "AMAT", "KLAC", "TER", "FORM", "AMKR"],
        "avg_note": "Avg computed for US stocks only",
    },
    "Data Center Power": {
        "avg_symbols": ["BE", "VRT", "GEV", "ETN", "POWL", "CPSH", "PWR", "HUBB", "HPS.A"],
        "avg_note": "Avg computed for US/CA stocks only",
    },
}


def _load_all_groups() -> dict[str, list[str]]:
    groups: dict[str, list[tuple[float, str]]] = {}
    with open(TICKER_CSV) as f:
        for row in csv.DictReader(f):
            order = float(row["display_order"]) if row.get("display_order") else float("inf")
            groups.setdefault(row["theme"], []).append((order, row["ticker"]))
    return {name: [t for _, t in sorted(entries)] for name, entries in groups.items()}


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
    all_groups = _load_all_groups()
    sections = []
    for section_name, show_avg, group_names in SECTIONS:
        groups = []
        for group_name in group_names:
            symbols = all_groups.get(group_name, [])
            if not symbols:
                continue
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
