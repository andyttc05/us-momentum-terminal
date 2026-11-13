import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Info } from "@phosphor-icons/react";

/**
 * Shared controls for grouped settings. They intentionally use the product's
 * existing warm surface and token names rather than introducing another theme.
 */
export function InfoTooltip({ label, children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const lastPointerType = useRef("mouse");
  const tooltipId = useId();

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltipWidth = Math.min(238, window.innerWidth - 24);
    const estimatedHeight = 92;
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - tooltipWidth / 2),
      window.innerWidth - tooltipWidth - 12,
    );
    const below = rect.bottom + 8;
    const top = below + estimatedHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - estimatedHeight - 8);
    setPosition({ left, top, width: tooltipWidth });
  }

  useEffect(() => {
    if (!open) return undefined;
    place();
    const closeOutside = (event) => {
      if (
        !triggerRef.current?.contains(event.target)
        && !tooltipRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <span className="info-tooltip">
      <button
        ref={triggerRef}
        type="button"
        className="info-tooltip__trigger"
        aria-label={`About ${label}`}
        aria-describedby={open ? tooltipId : undefined}
        onPointerDown={(event) => { lastPointerType.current = event.pointerType; }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => (
            lastPointerType.current === "mouse" ? true : !current
          ));
        }}
      >
        <Info size={16} weight="regular" aria-hidden="true" />
      </button>
      {open && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="info-tooltip__bubble"
          style={position}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}

export function SettingsCard({
  title,
  icon: Icon,
  description,
  action,
  children,
  className = "",
  ariaLabel,
}) {
  return (
    <section
      className={`settings-card ${className}`.trim()}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
    >
      {title && (
        <header className="settings-card__header">
          <span className="settings-card__title">
            {Icon && <Icon size={22} weight="regular" aria-hidden="true" />}
            <h3>{title}</h3>
            {description && <InfoTooltip label={title}>{description}</InfoTooltip>}
          </span>
          {action && <div className="settings-card__action">{action}</div>}
        </header>
      )}
      {children && <div className="settings-card__body">{children}</div>}
    </section>
  );
}

export function SettingsRow({
  title,
  icon,
  description,
  children,
  className = "",
}) {
  return (
    <SettingsCard
      title={title}
      icon={icon}
      description={description}
      action={children}
      className={`settings-row ${className}`.trim()}
    />
  );
}

export function CurrencyInput({
  id,
  value,
  onChange,
  ariaLabel,
  invalid = false,
  className = "",
}) {
  const rawValue = String(value ?? "");
  const displayValue = (() => {
    if (!/^\d+(\.\d*)?$/.test(rawValue)) return rawValue;
    const [whole, decimal] = rawValue.split(".");
    const grouped = Number(whole).toLocaleString("en-US");
    return decimal === undefined ? grouped : `${grouped}.${decimal}`;
  })();

  return (
    <div className={`currency-input backtest-amount-control ${className}`.trim()}>
      <span aria-hidden="true">$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        value={displayValue}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.]/g, "");
          const parts = next.split(".");
          onChange(parts.length > 2 ? `${parts.shift()}.${parts.join("")}` : next);
        }}
      />
      <span>USD</span>
    </div>
  );
}

export function Dropdown({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  className = "",
}) {
  return (
    <span className={`dropdown-control ${className}`.trim()} data-disabled={disabled || undefined}>
      <select
        id={id}
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown
        className="dropdown-control__arrow"
        size={20}
        weight="bold"
        aria-hidden="true"
      />
    </span>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className="toggle-control backtest-switch-button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-control__track backtest-switch" aria-hidden="true"><i /></span>
    </button>
  );
}
