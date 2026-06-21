import { useState } from "react";

interface SettingTooltipProps {
  title: string;
  children: React.ReactNode;
}

export default function SettingTooltip({ title, children }: SettingTooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="setting-tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="setting-tooltip-icon" title={title}>?</span>
      {open && (
        <span className="setting-tooltip-popup">
          {children}
        </span>
      )}
    </span>
  );
}
