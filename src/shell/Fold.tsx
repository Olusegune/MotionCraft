import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Disclosure. Collapsing keeps content mounted so no work is lost (UI_UX criterion 4). */
export function Fold({ title, children, defaultOpen = false, meta }: { title: string; children: ReactNode; defaultOpen?: boolean; meta?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`fold${open ? " open" : ""}`}>
      <button className="fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>{meta}
        <ChevronDown size={18} strokeWidth={1.75} className="chev" aria-hidden="true" />
      </button>
      <div id={id} className="fold-body" hidden={!open}>{children}</div>
    </section>
  );
}
