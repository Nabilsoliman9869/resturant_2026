import SettingTooltip from "./SettingTooltip";

interface SettingRowProps {
  label: string;
  tooltip?: string;
  tooltipTitle?: string;
  children: React.ReactNode;
}

export default function SettingRow({ label, tooltip, tooltipTitle, children }: SettingRowProps) {
  return (
    <div className="card">
      <div className="setting-card-header">
        <h4 style={{ marginTop: 0, marginBottom: 4 }}>{label}</h4>
        {tooltip && (
          <SettingTooltip title={tooltipTitle || label}>
            {tooltip}
          </SettingTooltip>
        )}
      </div>
      {children}
    </div>
  );
}
