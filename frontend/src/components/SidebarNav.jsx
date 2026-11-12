import { Briefcase, ChartLineUp, House, MagnifyingGlass } from "@phosphor-icons/react";
import { MascotDuo } from "./Mascot.jsx";
import { publicPath } from "../router.jsx";

const mainItems = [
  { id: "overview", label: "Overview", icon: House },
  { id: "screener", label: "Screener", icon: MagnifyingGlass },
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "backtesting", label: "Backtesting", icon: ChartLineUp },
];

function SidebarItem({ id, label, icon: Icon, active, disabled = false, onClick }) {
  const isActive = active === id;
  return (
    <button
      className={`sidebar-nav__item${isActive ? " is-active" : ""}`}
      type="button"
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="sidebar-nav__icon"><Icon size={22} weight="regular" aria-hidden="true" /></span>
      <span className="sidebar-nav__label">{label}</span>
    </button>
  );
}

export function SidebarNav({ active = "overview", onNavigate }) {
  return (
    <aside className="sidebar">
      <a
        className="brand-lockup"
        href={publicPath("/")}
        aria-label="US Momentum Terminal Overview"
        onClick={(event) => { event.preventDefault(); onNavigate?.("overview"); }}
      >
        <span className="brand-lockup__text">US Momentum<br />Terminal</span>
      </a>

      <div className="sidebar__rule" />
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {mainItems.map(({ id, label, icon }) => (
          <SidebarItem key={id} id={id} label={label} icon={icon} active={active} onClick={() => onNavigate?.(id)} />
        ))}
      </nav>

      <div className="sidebar__mascot" aria-hidden="true"><MascotDuo className="mascot-duo--reverse" creamColor="var(--color-surface)" /></div>
    </aside>
  );
}
