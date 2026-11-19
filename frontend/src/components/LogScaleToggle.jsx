/**
 * The one logarithmic-scale switch.
 *
 * Both the stock price chart and the backtest equity curve offer the same
 * toggle, so they share this control instead of each re-drawing a pill: the
 * geometry, the label typography and the on/off colour live in components.css,
 * next to the app's other switch (`.toggle-control`).
 *
 * The track is the shared `.toggle-control__track`, so the switch itself — 34 ×
 * 20 with a 16px knob, gold when on — has exactly one definition for the whole
 * app. `role="switch"` and `aria-checked` carry the state to assistive tech.
 */
export function LogScaleToggle({
  checked,
  onChange,
  label = "Log Scale",
  ariaLabel,
  disabled = false,
  reason,
}) {
  return (
    <button
      type="button"
      role="switch"
      className="log-scale-toggle"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      title={disabled ? reason : undefined}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="toggle-control__track" aria-hidden="true"><i /></span>
    </button>
  );
}
