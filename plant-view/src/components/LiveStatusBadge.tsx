export type ConnectionStatus = "live" | "reconnecting" | "polling" | "offline";

export function LiveStatusBadge({ status }: { status: ConnectionStatus }) {
  const isLive = status === "live";
  const isReconnecting = status === "reconnecting";
  const isOffline = status === "offline";

  const label = isLive
    ? "LIVE"
    : isReconnecting
      ? "Reconnecting"
      : isOffline
        ? "Offline"
        : "Polling";

  const statusClass = isLive
    ? "status-live"
    : isReconnecting
      ? "status-warn"
      : "status-offline";

  return (
    <div
      className={`live-status-badge ${statusClass}`}
      role="status"
      aria-label={`Connection status: ${label}`}
      aria-live="polite"
    >
      <span className="live-pulse-dot" aria-hidden="true" />
      <span className="live-status-label">{label}</span>
    </div>
  );
}
