import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Search } from "lucide-react";
import { Sheet } from "./Sheet";

export interface PaletteItem { id: string; label: string; hint?: string; run: () => void }

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const list = useMemo(() => items.filter((x) => x.label.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const pick = (n: number) => { const it = list[n]; if (it) { onClose(); it.run(); } };
  return (
    <Sheet title="Command palette" onClose={onClose}>
      <div className="palette">
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <input ref={ref} value={q} placeholder="Search actions and pages" aria-label="Search actions" role="combobox" aria-expanded="true" aria-controls="palette-list"
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(list.length - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(i); }
            }} />
        </label>
        <ul id="palette-list" role="listbox" aria-label="Results">
          {list.map((it, n) => (
            <li key={it.id} role="option" aria-selected={n === i}>
              <button className={n === i ? "on" : ""} onClick={() => pick(n)}>
                <Command size={16} aria-hidden="true" /><span>{it.label}</span>{it.hint && <span className="muted">{it.hint}</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="empty">Nothing matches that search.</li>}
        </ul>
      </div>
    </Sheet>
  );
}
