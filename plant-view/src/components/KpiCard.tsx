import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  secondary,
  subtext,
  badge,
  className = "",
}: {
  label: string;
  value: ReactNode;
  secondary?: ReactNode;
  subtext?: ReactNode;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="kpi-card-header">
        <span className="kpi-card-label">{label}</span>
        {badge ? <span className="kpi-card-badge">{badge}</span> : null}
      </div>
      <div className="kpi-card-value">{value}</div>
      {secondary ? <div className="kpi-card-secondary">{secondary}</div> : null}
      {subtext ? <div className="kpi-card-subtext">{subtext}</div> : null}
    </div>
  );
}
