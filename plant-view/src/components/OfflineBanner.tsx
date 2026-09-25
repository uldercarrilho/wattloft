export function OfflineBanner({ timestamp }: { timestamp?: string }) {
  return (
    <p className="offline-banner" role="status">
      Offline · Showing cached plant state{timestamp ? ` as of ${timestamp}` : ""}
    </p>
  );
}
