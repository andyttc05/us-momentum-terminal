# AGENT_RULES.md — Instructions for All Coding Agents

## 1. Role

You are an engineering agent contributing to US Momentum Terminal. The Product Owner decides product scope, priorities and acceptance. Do not silently expand the product or replace approved UI direction.

## 2. Read before acting

Read the handoff package and inspect the original sources and all UI reference images before making significant changes. For every task, inspect the existing codebase before editing it.

## 3. Source of truth

- Course compliance: `COURSE_DELIVERABLES.md` and original course guidelines PDF.
- Product scope: `PROJECT_BRIEF.md` and original proposal.
- Detailed requirements: `PRODUCT_REQUIREMENTS.md`.
- Calculations: `QUANTITATIVE_METHODOLOGY.md` and original full project guide.
- Visual design: `UI_DESIGN_BLUEPRINT.md` and image references.
- Architecture: `TECHNICAL_ARCHITECTURE.md`.

If sources conflict, stop and record the conflict in `OPEN_DECISIONS.md`; do not silently reconcile it.

## 4. Non-negotiable rules

1. Never invent live market values, company facts, backtest outputs, or API responses.
2. Label all static/demo fixtures clearly.
3. Do not change a financial formula without updating methodology, tests and version metadata.
4. Keep ranking and portfolio weighting as separate calculation stages.
5. Daily ranking refresh must not automatically trigger portfolio trades.
6. Official model portfolio rebalances semiannually in March and September unless Product Owner changes the rule.
7. Never silently violate 9% single-stock or 35% sector caps to force weights to 100%; report infeasible conditions.
8. Keep business logic out of Flask route handlers.
9. Keep market-data API calls on the backend, not in browser JavaScript.
10. Do not expose API keys, tokens or credentials in code, logs, screenshots or version control.
11. Do not add brokerage/order execution to the MVP.
12. Do not add UI components or page sections that are not supported by the approved blueprint or requirements.
13. Do not hard-code values from screenshots as actual financial data or settings defaults.
14. Do not treat total market capitalisation as float-adjusted market capitalisation.
15. Use point-in-time data in backtests where available; disclose when it is not.

## 5. Task execution protocol

For every task:

1. Restate the objective and identify dependencies.
2. Inspect relevant files and current architecture.
3. Propose the smallest implementation plan.
4. Implement only the agreed scope.
5. Add/update tests.
6. Run relevant tests and report exact results.
7. Review changed files for regressions/secrets/unintended changes.
8. Update relevant documentation.
9. Report files changed, tests run, assumptions, known limitations and next recommended task.

## 6. File ownership and parallel work

Before parallel agents work, agree module ownership and API/data contracts. Avoid multiple agents modifying the same files at the same time. Use branches or clearly separated task areas. The integration agent must review changes before merging.

Suggested ownership:

- Frontend: `frontend/` and frontend tests.
- Data/Backend: `backend/`, `data/`, `database/` and API contracts.
- Quant: `quant/` and quant unit tests.
- QA: `tests/integration/`, UI regression and acceptance review.
- Main Agent: architecture, integration, task coordination, documentation and final review.

## 7. Coding standards

- Prefer small typed functions with clear names and docstrings for non-trivial calculations.
- Handle missing, stale and invalid data explicitly.
- Use structured logging; do not swallow errors silently.
- Make calculation functions deterministic where possible.
- Use configuration rather than hard-coded thresholds.
- Keep provider-specific logic isolated.
- Use meaningful database constraints and indexes.
- Use semantic HTML and accessible labels/keyboard interactions.
- Keep responsive behaviour reasonable even though desktop is the primary target.

## 8. Completion report format

At the end of each assigned task, report:

- Summary
- Files created/modified
- Tests executed and pass/fail output
- Screenshots or API examples where useful
- Assumptions made
- Known limitations/open decisions
- Recommended next task

Do not state a task is complete if tests were not run or if known failures remain undisclosed.
