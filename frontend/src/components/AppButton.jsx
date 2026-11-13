import { ArrowRight } from "@phosphor-icons/react";

export function AppButton({
  children,
  variant = "primary",
  icon: Icon,
  iconOnly = false,
  onClick,
  type = "button",
  className = "",
  ariaLabel,
  disabled = false,
  buttonRef,
  ...buttonProps
}) {
  return (
    <button
      ref={buttonRef}
      className={`app-button app-button--${variant}${iconOnly ? " app-button--icon-only" : ""} ${className}`.trim()}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? ariaLabel : undefined}
      {...buttonProps}
    >
      {Icon && <Icon size={18} weight="regular" aria-hidden="true" />}
      {!iconOnly && <span>{children}</span>}
      {variant === "primary" && !Icon && !iconOnly && (
        <span className="app-button__arrow"><ArrowRight size={15} weight="bold" aria-hidden="true" /></span>
      )}
    </button>
  );
}
