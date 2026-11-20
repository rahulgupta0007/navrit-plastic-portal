"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type AdminSelectOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  className?: string;
  id?: string;
};

/**
 * Custom select so dropdown lists stay readable in admin dark mode
 * (native <option> popups on Windows often show light text on white).
 */
export function AdminSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  label,
  required = false,
  className = "",
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`ad-field ${className}`} ref={rootRef}>
      {label && (
        <span className="ad-field-label">
          {label}{required ? " *" : ""}
        </span>
      )}
      <button
        type="button"
        id={id}
        className="ad-input ad-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? "" : "ad-muted"}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={16} className={`ad-select-chevron ${open ? "open" : ""}`} />
      </button>
      {open && (
        <ul id={listId} role="listbox" className="ad-select-menu">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value || "__empty"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`ad-select-option ${active ? "active" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
