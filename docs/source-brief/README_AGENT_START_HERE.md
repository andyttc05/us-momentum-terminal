# US Momentum Terminal — AI Agent Handoff Package

**Prepared:** 11 November 2026  
**Project:** US Momentum Terminal  
**Purpose:** Give a coding agent the product context, original requirements, quantitative methodology, UI blueprint, architecture direction, development sequence, and rules needed to implement the project.

## Start here

Before writing or changing code, read these files in this order:

1. `PROJECT_BRIEF.md` — what the product is and what it must do.
2. `PRODUCT_REQUIREMENTS.md` — page-by-page and functional requirements.
3. `QUANTITATIVE_METHODOLOGY.md` — screening, momentum, score, ranking and portfolio calculations.
4. `UI_DESIGN_BLUEPRINT.md` — design system and all nine final screen references.
5. `TECHNICAL_ARCHITECTURE.md` — proposed stack, modules, database and API shape.
6. `DEVELOPMENT_ROADMAP.md` — staged implementation and acceptance gates.
7. `AGENT_RULES.md` — non-negotiable instructions for coding agents.
8. `OPEN_DECISIONS.md` — decisions that must be confirmed or clearly configured rather than guessed.
9. `COURSE_DELIVERABLES.md` — constraints from the IEDA 1180 course brief.

The original source documents (`SOURCE_DOCUMENTS/`) and the visual reference
images (`UI_REFERENCES/`) are course-provided or third-party material and are
**not redistributed** in this public repository. They are kept locally only.

## UI references

The numbered screenshot references and the Miyama visual-reference image were
third-party design material and have been removed from this public repository
for redistribution reasons. The written design direction they supported is
preserved in `UI_DESIGN_BLUEPRINT.md`.

## Recommended first instruction to the coding agent

> You are the lead engineering agent for US Momentum Terminal. Read the complete handoff package before making implementation decisions. First produce a concise architecture and task plan, identify the open decisions that block reliable implementation, and propose the project skeleton. Do not start by implementing the entire application in one pass. Follow `AGENT_RULES.md`, `DEVELOPMENT_ROADMAP.md`, and the quantitative rules exactly. Build in small, testable phases and report files changed, tests run, results, assumptions and unresolved issues after each task.

## Source hierarchy

When interpreting project information:

1. **IEDA 1180 Course Project Guidelines** govern course submission and academic-integrity constraints.
2. **Original Proposal** defines the submitted project idea and scope.
3. **Original Full Project Guide** provides the detailed implementation and methodology notes.
4. **This handoff package** consolidates those sources and the later approved UI revisions.
5. **UI screenshots** define visual direction, not live data or final numerical results.

If two source documents conflict, do not silently choose. Record the conflict in `OPEN_DECISIONS.md` and ask the Product Owner or present a clearly labelled proposal.

## Current delivery goal

Build a local, browser-based quantitative US equity screening and simulated portfolio application. The first milestone is a correct data pipeline, momentum engine, Top 100 ranking, portfolio weights, and functional dashboard. Backtesting and automation follow after the MVP has passed tests.
