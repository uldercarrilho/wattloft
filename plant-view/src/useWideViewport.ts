import { useEffect, useState } from "react";

export const WIDE_VIEWPORT = "(min-width: 60rem)";

export function useWideViewport(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_VIEWPORT).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE_VIEWPORT);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    setWide(media.matches);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}
