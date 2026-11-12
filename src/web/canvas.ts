/**
 * The dashboard is laid out on a virtual canvas 1920 wide whose height follows the screen's
 * aspect ratio, then scaled to fill the screen. Sizes in CSS are virtual pixels.
 */
import { useEffect, useState } from "react";

export const VIRTUAL_WIDTH = 1920;

export interface VirtualSize {
  width: 1920;
  height: number;
  scale: number;
}

export function virtualSize(innerWidth: number, innerHeight: number): VirtualSize {
  const scale = innerWidth / VIRTUAL_WIDTH;
  return { width: VIRTUAL_WIDTH, height: Math.round(innerHeight / scale), scale };
}

export function useVirtualCanvas(): VirtualSize {
  const [size, setSize] = useState(() => virtualSize(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const update = () => setSize(virtualSize(window.innerWidth, window.innerHeight));
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return size;
}
