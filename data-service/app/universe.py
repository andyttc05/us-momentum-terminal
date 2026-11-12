"""The investable universe for the terminal.

Company names and sectors here are *reference metadata* used for display and as
a fallback when a provider does not return a sector. Every price, volume,
market-cap and corporate-action value is fetched live from a provider - nothing
in this file is market data.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class UniverseMember:
    ticker: str
    name: str
    sector: str
    instrument_type: str = "Common stock"


# Sector names follow the vocabulary already used by the UI.
UNIVERSE: tuple[UniverseMember, ...] = (
    UniverseMember("NVDA", "NVIDIA", "Technology"),
    UniverseMember("AVGO", "Broadcom", "Technology"),
    UniverseMember("META", "Meta Platforms", "Communication"),
    UniverseMember("MSFT", "Microsoft", "Technology"),
    UniverseMember("AAPL", "Apple", "Technology"),
    UniverseMember("AMZN", "Amazon.com", "Consumer Discretionary"),
    UniverseMember("GOOGL", "Alphabet", "Communication"),
    UniverseMember("TSLA", "Tesla", "Consumer Discretionary"),
    UniverseMember("PLTR", "Palantir Technologies", "Technology"),
    UniverseMember("NFLX", "Netflix", "Communication"),
    UniverseMember("AMD", "Advanced Micro Devices", "Technology"),
    UniverseMember("ORCL", "Oracle", "Technology"),
    UniverseMember("JPM", "JPMorgan Chase", "Financials"),
    UniverseMember("COST", "Costco Wholesale", "Consumer Staples"),
    UniverseMember("LLY", "Eli Lilly", "Healthcare"),
    UniverseMember("WMT", "Walmart", "Consumer Staples"),
    UniverseMember("TSM", "Taiwan Semiconductor", "Technology", "ADR"),
    UniverseMember("V", "Visa", "Financials"),
    UniverseMember("MA", "Mastercard", "Financials"),
    UniverseMember("XOM", "Exxon Mobil", "Energy"),
    UniverseMember("CAT", "Caterpillar", "Industrials"),
    UniverseMember("ABBV", "AbbVie", "Healthcare"),
    UniverseMember("KO", "Coca-Cola", "Consumer Staples"),
    UniverseMember("DIS", "Walt Disney", "Communication"),
    UniverseMember("QCOM", "Qualcomm", "Technology"),
    UniverseMember("CRM", "Salesforce", "Technology"),
    UniverseMember("MU", "Micron Technology", "Technology"),
    UniverseMember("PANW", "Palo Alto Networks", "Technology"),
    UniverseMember("NOW", "ServiceNow", "Technology"),
    UniverseMember("GE", "GE Aerospace", "Industrials"),
    UniverseMember("ADI", "Analog Devices", "Technology"),
    UniverseMember("INTU", "Intuit", "Technology"),
    UniverseMember("MSCI", "MSCI", "Financials"),
    UniverseMember("ACN", "Accenture", "Technology"),
    UniverseMember("AMAT", "Applied Materials", "Technology"),
    UniverseMember("TXN", "Texas Instruments", "Technology"),
    UniverseMember("UBER", "Uber Technologies", "Industrials"),
    UniverseMember("BAC", "Bank of America", "Financials"),
    UniverseMember("GS", "Goldman Sachs", "Financials"),
    UniverseMember("UNH", "UnitedHealth Group", "Healthcare"),
    UniverseMember("ABT", "Abbott Laboratories", "Healthcare"),
    UniverseMember("NEE", "NextEra Energy", "Utilities"),
    UniverseMember("LIN", "Linde", "Materials"),
    UniverseMember("TMO", "Thermo Fisher Scientific", "Healthcare"),
    UniverseMember("BKNG", "Booking Holdings", "Consumer Discretionary"),
    UniverseMember("SNPS", "Synopsys", "Technology"),
    UniverseMember("KLAC", "KLA Corporation", "Technology"),
    UniverseMember("ISRG", "Intuitive Surgical", "Healthcare"),
    UniverseMember("HD", "Home Depot", "Consumer Discretionary"),
    UniverseMember("LOW", "Lowe's", "Consumer Discretionary"),
    UniverseMember("PEP", "PepsiCo", "Consumer Staples"),
    UniverseMember("PM", "Philip Morris", "Consumer Staples"),
    UniverseMember("MCD", "McDonald's", "Consumer Discretionary"),
    UniverseMember("SPGI", "S&P Global", "Financials"),
    UniverseMember("RTX", "RTX Corporation", "Industrials"),
    UniverseMember("LMT", "Lockheed Martin", "Industrials"),
    UniverseMember("DHR", "Danaher", "Healthcare"),
    UniverseMember("SYK", "Stryker", "Healthcare"),
    UniverseMember("IBM", "IBM", "Technology"),
    UniverseMember("CSCO", "Cisco Systems", "Technology"),
    UniverseMember("APP", "AppLovin", "Technology"),
    UniverseMember("CEG", "Constellation Energy", "Utilities"),
    UniverseMember("FICO", "Fair Isaac", "Technology"),
    UniverseMember("CMI", "Cummins", "Industrials"),
    UniverseMember("CVX", "Chevron", "Energy"),
    UniverseMember("PG", "Procter & Gamble", "Consumer Staples"),
    UniverseMember("TGT", "Target", "Consumer Discretionary"),
    UniverseMember("UPS", "UPS", "Industrials"),
    UniverseMember("DE", "Deere & Company", "Industrials"),
    UniverseMember("REGN", "Regeneron Pharmaceuticals", "Healthcare"),
    UniverseMember("BX", "Blackstone", "Financials"),
    UniverseMember("PFE", "Pfizer", "Healthcare"),
    UniverseMember("NKE", "Nike", "Consumer Discretionary"),
    UniverseMember("BA", "Boeing", "Industrials"),
    UniverseMember("CVS", "CVS Health", "Healthcare"),
    UniverseMember("MDLZ", "Mondelez International", "Consumer Staples"),
    UniverseMember("COP", "ConocoPhillips", "Energy"),
    UniverseMember("SO", "Southern Company", "Utilities"),
    UniverseMember("PLD", "Prologis", "Real Estate"),
    UniverseMember("AMT", "American Tower", "Real Estate"),
    UniverseMember("FDX", "FedEx", "Industrials"),
    UniverseMember("EMR", "Emerson Electric", "Industrials"),
    UniverseMember("ETN", "Eaton", "Industrials"),
    UniverseMember("MO", "Altria", "Consumer Staples"),
    UniverseMember("F", "Ford Motor", "Consumer Discretionary"),
    UniverseMember("GM", "General Motors", "Consumer Discretionary"),
    UniverseMember("KHC", "Kraft Heinz", "Consumer Staples"),
    UniverseMember("BMY", "Bristol Myers Squibb", "Healthcare"),
    UniverseMember("O", "Realty Income", "Real Estate"),
    UniverseMember("WELL", "Welltower", "Real Estate"),
    UniverseMember("AEP", "American Electric Power", "Utilities"),
    UniverseMember("EOG", "EOG Resources", "Energy"),
    UniverseMember("MPC", "Marathon Petroleum", "Energy"),
    UniverseMember("APD", "Air Products and Chemicals", "Materials"),
    UniverseMember("SHW", "Sherwin-Williams", "Materials"),
    UniverseMember("CCI", "Crown Castle", "Real Estate"),
    UniverseMember("D", "Dominion Energy", "Utilities"),
    UniverseMember("VZ", "Verizon Communications", "Communication"),
    UniverseMember("T", "AT&T", "Communication"),
    UniverseMember("CAG", "Conagra Brands", "Consumer Staples"),
    UniverseMember("WBA", "Walgreens Boots Alliance", "Consumer Staples"),
    UniverseMember("PARA", "Paramount Global", "Communication"),
    UniverseMember("NWSA", "News Corp", "Communication"),
    UniverseMember("FRT", "Federal Realty Investment Trust", "Real Estate"),
    UniverseMember("AES", "AES Corporation", "Utilities"),
    UniverseMember("IP", "International Paper", "Materials"),
    UniverseMember("HPE", "Hewlett Packard Enterprise", "Technology"),
    UniverseMember("HPQ", "HP Inc.", "Technology"),
    UniverseMember("KMI", "Kinder Morgan", "Energy"),
)

TICKERS: tuple[str, ...] = tuple(member.ticker for member in UNIVERSE)
MEMBER_BY_TICKER: dict[str, UniverseMember] = {member.ticker: member for member in UNIVERSE}

# Benchmarks are tracked separately so they never enter the momentum ranking.
BENCHMARKS: dict[str, str] = {
    "SPY": "SPDR S&P 500 ETF Trust",
    "SPMO": "Invesco S&P 500 Momentum ETF",
    "QQQ": "Invesco QQQ Trust",
}

# Yahoo's sector vocabulary -> the app's vocabulary.
SECTOR_MAP = {
    "Technology": "Technology",
    "Communication Services": "Communication",
    "Healthcare": "Healthcare",
    "Financial Services": "Financials",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "Utilities": "Utilities",
    "Real Estate": "Real Estate",
    "Basic Materials": "Materials",
}


def normalize_sector(raw: str | None, ticker: str) -> str:
    if raw:
        if raw in SECTOR_MAP:
            return SECTOR_MAP[raw]
        if raw in {member.sector for member in UNIVERSE}:
            return raw
    return MEMBER_BY_TICKER.get(ticker, UniverseMember(ticker, ticker, "Other")).sector
