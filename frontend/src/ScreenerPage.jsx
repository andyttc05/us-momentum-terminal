import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretUpDown,
  MagnifyingGlass,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { TableSkeletonRows, TableStateRow } from "./components/DataState.jsx";
import { ExportMenu } from "./components/ExportMenu.jsx";
import { MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { Pagination } from "./components/Pagination.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { Toast } from "./components/Toast.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket } from "./api/MarketProvider.jsx";
import { useUniverse } from "./api/UniverseProvider.jsx";
import { downloadCsvFile } from "./utils/csv.js";
import { getSectionState } from "./utils/dataState.js";
import { downloadWorkbookFile } from "./utils/exportFiles.js";
import { formatMarketCap } from "./utils/format.js";
import { momentumSeriesDomain, momentumSeriesValues } from "./utils/momentumSeries.js";
import { shouldOpenRow, shouldRouteTickerClick, stockLinkLabel } from "./utils/rowNavigation.js";
import { buildScreenerExportData, screenerFilename } from "./utils/screenerExport.js";
import { searchMatch } from "./utils/stockSearch.js";
import { datasetForUniverse } from "./utils/universeState.js";
import { stockPath } from "./router.jsx";

const emptyFilters = { sector: "", minPrice: "", maxPrice: "", minMomentum: "", minScore: "" };
const rowsPerPage = 10;
// [value key, heading label, class slug] — the slug keeps the CSS hook
// readable (e.g. `marketCap` -> `stock-heading--market-cap`).
const sortableColumns = [
  ["ticker", "Ticker", "ticker"],
  ["company", "Company", "company"],
  ["marketCap", "Market Cap", "market-cap"],
  ["price", "Price", "price"],
  ["change", "1D Change", "change"],
  ["momentum", "12–1 Momentum", "momentum"],
  ["score", "Score", "score"],
  ["sector", "Sector", "sector"],
];

function formatPrice(price) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(price);
}

function formatPercent(value, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function SortIcon({ active, direction }) {
  if (!active) return <CaretUpDown size={14} weight="bold" aria-hidden="true" />;
  return direction === "asc"
    ? <ArrowUp size={14} weight="bold" aria-hidden="true" />
    : <ArrowDown size={14} weight="bold" aria-hidden="true" />;
}

export function ScreenerPage({ isActive = true, onSelectStock }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState({ key: "score", direction: "desc" });
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const filterControlRef = useRef(null);
  const { data, refresh, status, error, refreshing } = useMarket();
  const { activeUniverse, activateUniverse } = useUniverse();
  const universe = activeUniverse;

  // The rows are the active dataset's selection — exactly the names the model
  // portfolio holds, so the record count, the pagination and the exports all
  // agree with Overview and Portfolio.
  const dataset = datasetForUniverse(data, activeUniverse);
  const stocks = dataset?.stocks ?? [];
  const sectors = useMemo(() => [...new Set(stocks.map((stock) => stock.sector))].sort(), [stocks]);
  const snapshot = dataset?.overview?.snapshot;
  const tableState = getSectionState({
    hasData: stocks.length > 0,
    status,
    error,
    refreshing,
  });
  const columnCount = 9;

  useEffect(() => {
    setPage(1);
  }, [activeUniverse]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    function closeOnOutsideClick(event) {
      if (!filterControlRef.current?.contains(event.target)) setFiltersOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);

  function showToast(message, kind = "updated") {
    setToast({ message, kind });
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => setToast(""), 2600);
  }

  const filteredStocks = useMemo(() => {
    const query = search.trim();
    return stocks
      .map((stock) => ({ stock, searchPriority: searchMatch(stock, query) }))
      .filter((entry) => entry.searchPriority !== null)
      .filter(({ stock }) => !filters.sector || stock.sector === filters.sector)
      .filter(({ stock }) => filters.minPrice === "" || stock.price >= Number(filters.minPrice))
      .filter(({ stock }) => filters.maxPrice === "" || stock.price <= Number(filters.maxPrice))
      .filter(({ stock }) => filters.minMomentum === "" || stock.momentum >= Number(filters.minMomentum))
      .filter(({ stock }) => filters.minScore === "" || stock.score >= Number(filters.minScore))
      .sort((aEntry, bEntry) => {
        if (query && aEntry.searchPriority !== bEntry.searchPriority) {
          return aEntry.searchPriority - bEntry.searchPriority;
        }
        const a = aEntry.stock;
        const b = bEntry.stock;
        const left = a[sort.key];
        const right = b[sort.key];
        // A missing market cap is unknown, not zero: keep those rows last in
        // both directions instead of letting them sort as 0.
        const leftMissing = left === null || left === undefined;
        const rightMissing = right === null || right === undefined;
        if (leftMissing || rightMissing) {
          if (leftMissing && rightMissing) return 0;
          return leftMissing ? 1 : -1;
        }
        const result = typeof left === "string" ? left.localeCompare(right) : left - right;
        return result * (sort.direction === "asc" ? 1 : -1);
      })
      .map(({ stock }) => stock);
  }, [filters, search, sort, stocks]);
  // One scale for the whole universe, not for the visible page: narrowing the
  // table must never silently rescale the sparklines, and a row keeps its shape
  // wherever sorting, search and pagination move it.
  const sparklineDomain = useMemo(() => momentumSeriesDomain(stocks), [stocks]);

  const totalPages = Math.max(1, Math.ceil(filteredStocks.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * rowsPerPage;
  const visibleStocks = filteredStocks.slice(firstIndex, firstIndex + rowsPerPage);
  const activeFilterCount = Object.values(filters).filter((value) => value !== "").length;
  const firstResult = filteredStocks.length ? firstIndex + 1 : 0;
  const lastResult = Math.min(firstIndex + rowsPerPage, filteredStocks.length);

  function setSearchValue(value) {
    setSearch(value);
    setPage(1);
  }

  function selectMode(nextMode) {
    if (nextMode === activeUniverse) return;
    activateUniverse(nextMode);
    setPage(1);
  }

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
    setPage(1);
  }

  function openFilters() {
    setDraftFilters(filters);
    setFiltersOpen((open) => !open);
  }

  function applyFilters(event) {
    event.preventDefault();
    setFilters({ ...draftFilters });
    setPage(1);
    setFiltersOpen(false);
  }

  function resetFilters() {
    setFilters(emptyFilters);
    setDraftFilters(emptyFilters);
    setPage(1);
  }

  async function exportResults(format) {
    if (!filteredStocks.length || isExporting) return;
    setIsExporting(true);
    try {
      const exportData = buildScreenerExportData({
        stocks: filteredStocks,
        universe,
        filters,
        search,
        meta: data?.meta ?? null,
        exportedAt: new Date().toISOString(),
      });
      const filename = screenerFilename(universe, format);
      if (format === "csv") {
        downloadCsvFile(filename, exportData.csv);
      } else {
        await downloadWorkbookFile(filename, exportData.workbookSheets);
      }
      showToast("Export completed");
    } catch {
      showToast("Export failed", "error");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="app-main" hidden={!isActive}>
      <div className="page screener-page" id="screener">
        <PageHeader
          eyebrow="Stock"
          title="Screener"
          subtitle="Find momentum stocks"
          art={<MascotDuo creamColor="var(--color-surface)" />}
          controls={(
            <UpdateBar
              dateTime={snapshot?.asOf}
              ariaLabel="Refresh screener"
              onRefresh={refresh}
            />
          )}
        />

        <section className="screener-toolbar" aria-label="Screener controls">
          <div className="screener-scope" role="group" aria-label="Dataset universe">
            <button type="button" aria-pressed={universe === "top100"} className={universe === "top100" ? "is-selected" : ""} onClick={() => selectMode("top100")}>Top 100</button>
            <button type="button" aria-pressed={universe === "top20"} className={universe === "top20" ? "is-selected" : ""} onClick={() => selectMode("top20")}>Top 20</button>
          </div>

          <label className="screener-search">
            <MagnifyingGlass size={24} weight="regular" aria-hidden="true" />
            <span className="visually-hidden">Search ticker or company</span>
            <input value={search} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search ticker or company" />
            {search && <button type="button" className="screener-search__clear" aria-label="Clear search" onClick={() => setSearchValue("")}><X size={18} /></button>}
          </label>

          <div className="screener-toolbar__actions">
            <div className="screener-filter-wrap" ref={filterControlRef}>
              <AppButton
                variant="secondary"
                icon={SlidersHorizontal}
                className={`screener-toolbar__button${activeFilterCount ? " has-active-filters" : ""}`}
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={openFilters}
              >
                Filters{activeFilterCount > 0 && <span className="active-filter-dot" aria-label={`${activeFilterCount} active filters`} />}
              </AppButton>
              {filtersOpen && (
                <form className="screener-filter-panel" role="dialog" aria-label="Stock filters" onSubmit={applyFilters}>
                  <div className="screener-filter-panel__heading">
                    <strong>Filters</strong>
                    {activeFilterCount > 0 && <span>{activeFilterCount} active</span>}
                  </div>
                  <label className="screener-filter-field screener-filter-field--wide">
                    <span>Sector</span>
                    <select value={draftFilters.sector} onChange={(event) => setDraftFilters((current) => ({ ...current, sector: event.target.value }))}>
                      <option value="">All sectors</option>
                      {sectors.map((sector) => <option value={sector} key={sector}>{sector}</option>)}
                    </select>
                  </label>
                  <div className="screener-filter-grid">
                    <label className="screener-filter-field">
                      <span>Min price</span>
                      <input type="number" min="0" step="0.01" placeholder="$0" value={draftFilters.minPrice} onChange={(event) => setDraftFilters((current) => ({ ...current, minPrice: event.target.value }))} />
                    </label>
                    <label className="screener-filter-field">
                      <span>Max price</span>
                      <input type="number" min="0" step="0.01" placeholder="No limit" value={draftFilters.maxPrice} onChange={(event) => setDraftFilters((current) => ({ ...current, maxPrice: event.target.value }))} />
                    </label>
                    <label className="screener-filter-field">
                      <span>Min 12–1 momentum</span>
                      <input type="number" step="0.1" placeholder="Any" value={draftFilters.minMomentum} onChange={(event) => setDraftFilters((current) => ({ ...current, minMomentum: event.target.value }))} />
                    </label>
                    <label className="screener-filter-field">
                      <span>Min score</span>
                      <input type="number" min="0" step="0.01" placeholder="Any" value={draftFilters.minScore} onChange={(event) => setDraftFilters((current) => ({ ...current, minScore: event.target.value }))} />
                    </label>
                  </div>
                  <div className="screener-filter-panel__actions">
                    <button type="button" className="filter-reset-button" onClick={resetFilters}>Reset</button>
                    <button type="submit" className="filter-apply-button">Apply filters</button>
                  </div>
                </form>
              )}
            </div>
            <div className="screener-export-control">
              <ExportMenu
                onExport={exportResults}
                disabled={!filteredStocks.length}
                busy={isExporting}
                ariaLabel="Export current Screener results"
                triggerVariant="app"
                triggerClassName="screener-toolbar__button"
              />
            </div>
          </div>
        </section>

        <section className="screener-table-card dashboard-card" aria-label="Momentum stocks">
          <div className="screener-table-scroll">
            <table
              className="screener-table"
              data-state={tableState}
              aria-busy={tableState === "loading" || undefined}
            >
              <colgroup>
                <col className="stock-col-rank" />
                <col className="stock-col-ticker" />
                <col className="stock-col-company" />
                <col className="stock-col-market-cap" />
                <col className="stock-col-price" />
                <col className="stock-col-change" />
                <col className="stock-col-momentum" />
                <col className="stock-col-score" />
                <col className="stock-col-sector" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="stock-rank-heading">#</th>
                  {sortableColumns.map(([key, label, slug]) => (
                    <th scope="col" key={key} className={`stock-heading stock-heading--${slug}`} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`}>
                        <span>{label}</span><SortIcon active={sort.key === key} direction={sort.direction} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableState === "loading" ? (
                  <TableSkeletonRows columns={columnCount} rows={rowsPerPage} />
                ) : visibleStocks.length ? visibleStocks.map((stock) => (
                  <tr
                    key={stock.ticker}
                    className="stock-row"
                    onClick={(event) => {
                      if (shouldOpenRow(event)) onSelectStock?.(stock.ticker);
                    }}
                  >
                    <td className="stock-rank-cell"><span>{stock.rank}</span></td>
                    <td className="stock-ticker-cell">
                      <a
                        className="stock-ticker-link"
                        href={stockPath(stock.ticker)}
                        aria-label={stockLinkLabel(stock.ticker)}
                        onClick={(event) => {
                          if (!shouldRouteTickerClick(event)) return;
                          event.preventDefault();
                          onSelectStock?.(stock.ticker);
                        }}
                      >
                        {stock.ticker}
                      </a>
                    </td>
                    <td className="stock-company-cell" title={stock.company}>{stock.company}</td>
                    <td className="stock-market-cap-cell">{formatMarketCap(stock.marketCap)}</td>
                    <td className="stock-price-cell">{formatPrice(stock.price)}</td>
                    <td className="stock-change-cell"><span className={stock.change >= 0 ? "change-pill is-positive" : "change-pill is-negative"}>{formatPercent(stock.change)}</span></td>
                    <td className="stock-momentum-cell">
                      <div className="stock-momentum-cell__content">
                        <Sparkline
                          values={momentumSeriesValues(stock)}
                          domain={sparklineDomain}
                          label={`${stock.ticker} 12–1 momentum`}
                          className={stock.momentum >= 0 ? "" : "sparkline--negative"}
                        />
                        <strong className={stock.momentum >= 0 ? "momentum-value is-positive" : "momentum-value is-negative"}>{formatPercent(stock.momentum, 1)}</strong>
                      </div>
                    </td>
                    <td className="stock-score-cell"><span>{stock.score.toFixed(2)}</span></td>
                    <td className="stock-sector-cell" title={stock.sector}>{stock.sector}</td>
                  </tr>
                )) : (
                  stocks.length ? (
                    <TableStateRow
                      columns={columnCount}
                      state="empty"
                      title="No stocks match your search or filters."
                      detail="Try adjusting your criteria."
                    />
                  ) : (
                    <TableStateRow
                      columns={columnCount}
                      state={tableState}
                      title={tableState === "error" ? "Rankings unavailable" : "No rankings available"}
                      detail={tableState === "error"
                        ? "The latest verified rankings could not be loaded. Use the update control to retry."
                        : "The provider returned no eligible stocks for this universe."}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={currentPage}
            totalPages={totalPages}
            rangeStart={firstResult}
            rangeEnd={lastResult}
            total={filteredStocks.length}
            onPageChange={setPage}
            label="Screener table pagination"
          />
        </section>
      </div>
      {isActive && toast && (
        <Toast kind={toast.kind} message={toast.message} className="page-toast" durationMs={2600} />
      )}
    </main>
  );
}
