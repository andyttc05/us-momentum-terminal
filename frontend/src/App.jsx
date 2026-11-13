import { MarketProvider } from "./api/MarketProvider.jsx";
import { UniverseProvider } from "./api/UniverseProvider.jsx";
import { OverviewPage } from "./OverviewPage.jsx";
import { PortfolioPage } from "./PortfolioPage.jsx";
import { ScreenerPage } from "./ScreenerPage.jsx";
import { BacktestingPage } from "./BacktestingPage.jsx";
import { StockAnalysisPage } from "./StockAnalysisPage.jsx";
import { SidebarNav } from "./components/SidebarNav.jsx";
import { StatusToast } from "./components/StatusToast.jsx";
import { RouterProvider, backLabelFor, backPathFor, useRouter, useStockNavigation } from "./router.jsx";

function Shell() {
  const { page, ticker, navigate, historyState } = useRouter();
  const openStock = useStockNavigation();
  const from = historyState?.from ?? null;

  // A real history step keeps browser Back/Forward correct when we arrived from
  // inside the app; a deep link falls back to a safe in-app route.
  function goBack() {
    if (from) window.history.back();
    else navigate(backPathFor(from), { replace: true });
  }

  function goToPage(id) {
    navigate(id === "overview" ? "/" : `/${id}`);
  }

  return (
    <div className="app-shell">
      <SidebarNav active={page} onNavigate={goToPage} />

      <OverviewPage
        hidden={page !== "overview"}
        onNavigate={goToPage}
        onSelectStock={openStock}
      />
      <ScreenerPage isActive={page === "screener"} onSelectStock={openStock} />
      <PortfolioPage hidden={page !== "portfolio"} onSelectStock={openStock} />
      <BacktestingPage hidden={page !== "backtesting"} />

      {page === "stock-analysis" && (
        <StockAnalysisPage
          ticker={ticker}
          backLabel={backLabelFor(from)}
          onBack={goBack}
        />
      )}

      <StatusToast />
    </div>
  );
}

export function App() {
  return (
    <RouterProvider>
      <UniverseProvider>
        <MarketProvider>
          <Shell />
        </MarketProvider>
      </UniverseProvider>
    </RouterProvider>
  );
}
