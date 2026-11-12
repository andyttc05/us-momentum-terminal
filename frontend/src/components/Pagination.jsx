import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";

/** Windowed page numbers with a stable number of slots so the row never reflows. */
export function getPageNumbers(page, pages) {
  if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, 4, 5, "…", pages];
  if (page >= pages - 2) return [1, "…", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "…", page - 1, page, page + 1, "…", pages];
}

export function Pagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  total,
  onPageChange,
  label = "Table pagination",
}) {
  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <footer className="table-pagination">
      <span className="table-pagination__range">Showing {rangeStart}–{rangeEnd} of {total}</span>
      <nav className="table-pagination__controls" aria-label={label}>
        <button
          type="button"
          className="pagination-arrow"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ArrowLeft size={20} weight="regular" aria-hidden="true" />
        </button>
        <div className="pagination-page-list">
          {pageNumbers.map((pageNumber, index) => pageNumber === "…"
            /* Positional key: the head ellipsis keeps its identity when the
               window shifts, so React reuses the node instead of remounting it. */
            ? <span className="pagination-ellipsis" key={index === 1 ? "ellipsis-start" : "ellipsis-end"} aria-hidden="true">…</span>
            : (
              <button
                type="button"
                key={pageNumber}
                aria-current={page === pageNumber ? "page" : undefined}
                className={page === pageNumber ? "is-current" : undefined}
                onClick={() => onPageChange(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
        </div>
        <button
          type="button"
          className="pagination-arrow"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          <ArrowRight size={20} weight="regular" aria-hidden="true" />
        </button>
      </nav>
    </footer>
  );
}
