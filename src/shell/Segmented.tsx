export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T;
  options: { value: T; label: string; disabled?: boolean; why?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} disabled={o.disabled} title={o.disabled ? o.why : undefined}
          className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
