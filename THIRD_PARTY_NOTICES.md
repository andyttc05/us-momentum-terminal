# Third-Party Notices

The [MIT License](LICENSE) that covers this project's original source code,
documentation and other original material applies only to material the project
contributors are entitled to license.

This notice records the third-party material that is present in the repository
or used by the project, and the terms that apply to it. No ownership of
third-party material is claimed by this project.

## Market data

Market data, quotes, fundamentals and derived datasets are retrieved at runtime
from third-party providers and are governed by those providers' own terms of
use.

- **Yahoo Finance** (via the unofficial `yfinance` client) — default provider.
- **Stooq** — backup provider.
- **Twelve Data, Financial Modeling Prep, Alpha Vantage, Finnhub** — optional
  backup providers, enabled only when the corresponding API key is configured.

Provider-retrieved price history is written to the local runtime cache
(`data-service/cache/`) and is intentionally **not** committed to this
repository. The audit evidence committed under `data-service/docs/` contains
only aggregate summaries, coverage statistics and symbol identifiers — not raw
price series.

The MIT License grants no permission to redistribute restricted financial data.
Anyone redistributing this project, or any dataset derived from it, is
responsible for checking and complying with the applicable provider terms.

## Third-party libraries, fonts and icons

| Component | License |
| --- | --- |
| React, React DOM | MIT |
| Vite, `@vitejs/plugin-react` | MIT |
| `@phosphor-icons/react` | MIT |
| FastAPI, Uvicorn | MIT / BSD / Apache-2.0 as applicable |
| yfinance, pandas, NumPy | Apache-2.0 / BSD as applicable |
| exchange-calendars | MIT |
| requests | Apache-2.0 |

These remain subject to their own original licenses. See each dependency's own
distribution for the authoritative terms.

## Documentation and design references

Screenshots of the application itself under `docs/audit-screenshots/` and
`docs/reference-screenshots/` are project documentation and are covered by the
MIT License.

Course-provided documents (the IEDA 1180 course guidelines, the original project
proposal and the original full project guide) and third-party design material
(the Miyama Graphics visual reference and the conceptual UI blueprint images)
are **not redistributed** in this repository. They were removed from the public
repository because redistribution is not clearly permitted; the originals are
kept locally only. The written design direction derived from them is preserved
in `docs/source-brief/UI_DESIGN_BLUEPRINT.md`, which remains project-authored
documentation.
