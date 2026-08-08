import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  tableLabel: string;
  captainLabel?: string | null;
  sessionHint?: string | null;
  items: ManagerTableInstructionItem[];
  onClose: () => void;
};

/**
 * قائمة «تعليمات المدير» — تظهر بكليك يمين على الطاولة من اللوحة الحية / شريحات الطاولات.
 */
export function ManagerTableInstructionsMenu({
  open,
  x,
  y,
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
    const w = el?.offsetWidth || 280;
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
      aria-label="تعليمات المدير"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 1200,
        width: "min(300px, calc(100vw - 16px))",
        maxHeight: "min(70vh, 420px)",
        overflow: "auto",
        direction: "rtl",
        background: "rgba(15, 23, 42, 0.98)",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: 12,
        boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
        padding: "0.55rem 0.45rem",
        color: "#f8fafc",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{ padding: "0.35rem 0.55rem 0.5rem", borderBottom: "1px solid rgba(148,163,184,0.22)", marginBottom: 4 }}>
        <div style={{ fontWeight: 900, fontSize: "0.95rem" }}>تعليمات المدير</div>
        <div style={{ fontSize: "0.78rem", color: "#cbd5e1", marginTop: 2 }}>
          {tableLabel || "طاولة"}
          {captainLabel ? ` · كابتن: ${captainLabel}` : " · بلا كابتن"}
        </div>
        {sessionHint ? (
          <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 2 }}>{sessionHint}</div>
        ) : null}
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.hint || item.label}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            style={{
              textAlign: "right",
              border: item.primary ? "1px solid rgba(250, 204, 21, 0.45)" : "1px solid transparent",
              background: item.primary
                ? "rgba(250, 204, 21, 0.14)"
                : item.danger
                  ? "rgba(239, 68, 68, 0.1)"
                  : "transparent",
              color: item.disabled ? "#64748b" : item.danger ? "#fecaca" : item.primary ? "#fef08a" : "#f1f5f9",
              borderRadius: 8,
              padding: "0.55rem 0.65rem",
              fontWeight: item.primary ? 900 : 700,
              fontSize: "0.86rem",
              cursor: item.disabled ? "not-allowed" : "pointer",
              opacity: item.disabled ? 0.55 : 1,
              font: "inherit",
            }}
          >
            <div>{item.label}</div>
            {item.hint ? (
              <div style={{ fontSize: "0.7rem", fontWeight: 500, opacity: 0.75, marginTop: 2 }}>{item.hint}</div>
            ) : null}
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
