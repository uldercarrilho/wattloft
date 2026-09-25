export function StallBanner({ message }: { message: string }) {
  return (
    <div className="stall-banner" role="status">
      <span className="stall-banner-icon" aria-hidden="true">⚠️</span>
      <span className="stall-banner-text">{message}</span>
    </div>
  );
}
