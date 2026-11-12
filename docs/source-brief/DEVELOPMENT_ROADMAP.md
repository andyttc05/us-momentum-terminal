# Development Roadmap — AI Agent Implementation Plan

## Guiding strategy

Build a modular, testable MVP in small phases. Do not ask an agent to generate the entire application in one unreviewed pass. Complete and test one layer before depending on it in another.

## Phase 0 — Repository and specification lock

### Tasks
- Read the handoff package and source documents.
- Create Git repository and baseline commit.
- Create project skeleton and Python virtual environment.
- Add `AGENTS.md`, README, requirements and `.env.example`.
- Confirm open methodology/provider decisions and record them.
- Create basic Flask app and health endpoint.

### Acceptance
- App starts locally.
- Folder/module boundaries are established.
- Environment and setup instructions are reproducible.
- No unapproved stack change.

## Phase 1 — Frontend shell and static UI

### Tasks
- Build shared sidebar, header, settings tabs and UI components.
- Implement Overview, Screener, Portfolio, Backtesting, Stock Analysis and four Settings routes.
- Match supplied screenshots for desktop layout.
- Use clearly labelled mock/demo fixtures only.
- Implement navigation, controls, table sorting/pagination states and empty/loading/error states.

### Acceptance
- All nine screen concepts are reachable.
- Sidebar and Settings navigation work.
- Visual regression screenshots are reviewed against `UI_REFERENCES/`.
- No mock number is represented as live/verified data.

## Phase 2 — Database and data provider

### Tasks
- Define SQLite schema and initialization/migration strategy.
- Implement provider interface and initial yfinance adapter.
- Load a small test universe first; expand to 500–1,000 after successful validation.
- Retrieve daily OHLCV and available metadata/fundamentals.
- Implement incremental updates, retries, upserts and logs.
- Implement data quality report.

### Acceptance
- Repeat data import does not duplicate ticker/date rows.
- Failures are logged and visible.
- Stored values pass data validation.
- Provider can be replaced without changing quant engine code.

## Phase 3 — Eligibility and Momentum Engine

### Tasks
- Implement security-type/exchange filters.
- Implement minimum price, history and liquidity filters.
- Implement 12–1 momentum and explicitly configured fallback policy.
- Implement same-window daily volatility and risk-adjusted momentum.
- Implement cross-sectional Z-score and capping.
- Implement piecewise Momentum Score.
- Implement Top 100 and Top 20% ranking modes.

### Acceptance
- Unit tests use synthetic known datasets.
- Most-recent-month exclusion is verified.
- Invalid/insufficient data is flagged.
- Ranking is deterministic for a given data snapshot and methodology version.

## Phase 4 — Portfolio construction

### Tasks
- Calculate float-adjusted market cap where data exists.
- Implement and version fallback policy for missing float data.
- Calculate raw weights and normalise.
- Implement iterative stock/sector cap enforcement and redistribution.
- Detect infeasible cases and return explicit errors/status.
- Store rebalance metadata and holdings.

### Acceptance
- Raw weights sum to 100% before constraints.
- Feasible final portfolio is non-negative, <=9% per stock, <=35% per sector and totals 100% within tolerance.
- Infeasible cases are not silently forced through.

## Phase 5 — API and frontend integration

### Tasks
- Add JSON endpoints for overview, screener, stock, portfolio, status and settings.
- Replace frontend mock data with API responses.
- Add server-side search/filter/sort/pagination where appropriate.
- Add date/as-of labels and data health states.
- Implement Settings persistence and validation.

### Acceptance
- Each page displays data from the local backend.
- API errors and stale/missing data have meaningful UI states.
- Settings reload after save and persist in SQLite/config storage.
- No frontend provider secrets.

## Phase 6 — Backtesting

### Tasks
- Build point-in-time historical universe snapshots where source data permits.
- Implement historical rebalance procedure.
- Model holdings between rebalance dates.
- Integrate SPY and SPMO benchmark series.
- Apply transaction costs and slippage assumptions.
- Calculate all required metrics and annual returns.
- Store reproducible backtest configuration/results.

### Acceptance
- No look-ahead leakage in tested rebalance examples.
- Strategy and benchmarks use matching dates/return conventions.
- Cost assumptions are applied at trades.
- Data limitations are reported prominently.

## Phase 7 — Scheduling and reliability

### Tasks
- Add APScheduler daily ranking job.
- Add March/September portfolio rebalance jobs.
- Add locks, retries, job status and logs.
- Add manual refresh and recovery flow.

### Acceptance
- Jobs cannot overlap unsafely.
- Errors do not corrupt latest valid snapshots.
- Last successful update and current status are visible.

## Phase 8 — QA, documentation and course hand-in

### Tasks
- Unit, integration and UI tests.
- Review all screens against screenshots.
- Verify calculation outputs and edge cases.
- Prepare README, setup instructions, source-data links and reproducible commands.
- Prepare course report and AI-use disclosure in the student's own words.

### Acceptance
- Another person can follow the instructions and reproduce the displayed results, subject to documented data availability.
- No critical known test failure is hidden.
- Course report meets the official length and submission requirements.

## Recommended first sprint

1. Make repository and project skeleton.
2. Build shared sidebar + page routing.
3. Implement static Overview and Screener with sample fixtures labelled as demo.
4. Add SQLite schema and provider adapter.
5. Test data download and storage for a small set of symbols.

Do not begin backtest UI integration before a reliable return-data convention and quant pipeline exist.
