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
(`data-service/cache/`) and is **not** committed. GitHub Actions publishes a
derived, validated snapshot under `frontend/public/data/` so the static site
can display current market information without a backend. That public snapshot
contains quotes, weekly price samples and computed analytics; it does not omit
the provider's rights merely because it is derived.

The MIT License grants no permission to redistribute restricted financial data.
Anyone redistributing this project, the generated publication, or another
dataset derived from it is responsible for checking and complying with the
applicable provider terms. For commercial or redistribution-sensitive use,
replace the unofficial Yahoo path with a provider licence that explicitly
permits the intended publication.

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

## Documentation and screenshots

Screenshots of the application itself under `docs/screenshots/` are project
documentation and are covered by the MIT License.

Course-provided documents, the original proposal and guide, third-party design
reference images, internal handoff prompts and obsolete development reports are
not included in this repository. They are kept in a separate local archive
outside the public project because redistribution is not clearly permitted.
