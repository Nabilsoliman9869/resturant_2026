import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../styles/operationalRoles.css";

export type ManagerTableInstructionItem = {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  onSelect: () => void;
};

type ManagerTableInstructionsMenuProps = {
  open: boolean;
  x: number;
  y: number;
  /** عنوان القائمة — افتراضي «تعليمات المدير» */
  title?: string;
  tableLabel: string;
  captainLabel?: string | null;
  sessionHint?: string | null;
  items: ManagerTableInstructionItem[];
  onClose: () => void;
};

/**
 * قائمة «تعليمات المدير» — كليك يمين؛ زجاجية مع خط واضح فوق نقطة البيع.
 */
export function ManagerTableInstructionsMenu({
  open,
  x,
  y,
  title = "تعليمات المدير",
  tableLabel,
  captainLabel,
  sessionHint,
  items,
  onClose,
}: ManagerTableInstructionsMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el?.offsetWidth || 300;
    const h = el?.offsetHeight || 320;
    let left = x;
    let top = y;
    if (left + w + pad > vw) left = Math.max(pad, vw - w - pad);
    if (top + h + pad > vh) top = Math.max(pad, vh - h - pad);
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [open, x, y, items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current && t && !panelRef.current.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={title}
      className="mgr-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{ padding: "0.4rem 0.55rem 0.55rem", borderBottom: "1px solid rgba(15,23,42,0.1)", marginBottom: 4 }}>
        <div className="mgr-ctx-menu__title">{title}</div>
        <div className="mgr-ctx-menu__sub">
          {tableLabel || "—"}
          {captainLabel ? ` · ${captainLabel}` : ""}
        </div>
        {sessionHint ? <div className="mgr-ctx-menu__hint">{sessionHint}</div> : null}
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.hint || item.label}
            className={`mgr-ctx-menu__item${item.primary ? " is-primary" : ""}${item.danger ? " is-danger" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            <div>{item.label}</div>
            {item.hint ? <div className="mgr-ctx-menu__item-hint">{item.hint}</div> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function managerOrderTakerBase(pathname: string): string {
  if (pathname.startsWith("/app/manager")) return "/app/manager";
  if (pathname.startsWith("/app/operation_manager")) return "/app/operation_manager";
  if (pathname.startsWith("/app/developer")) return "/app/developer";
  if (pathname.startsWith("/app/cashier")) return "/app/cashier";
  return "/app/waiter";
}
