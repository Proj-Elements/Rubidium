"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type ScrollMetrics = { top: number; thumb: number; scrollable: boolean; value: number };

export function FloatingScrollbar() {
  const track = useRef<HTMLDivElement>(null);
  const dragPointer = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ top: 0, thumb: 0, scrollable: false, value: 0 });
  const [visible, setVisible] = useState(false);

  const update = useCallback(() => {
    const viewport = window.innerHeight;
    const trackHeight = Math.max(0, Math.min(viewport * 0.64, viewport - 32));
    const scrollHeight = document.documentElement.scrollHeight;
    const maxScroll = Math.max(0, scrollHeight - viewport);
    const thumb = maxScroll ? Math.max(36, trackHeight * viewport / scrollHeight) : trackHeight;
    const top = maxScroll ? (trackHeight - thumb) * window.scrollY / maxScroll : 0;
    setMetrics({ top, thumb, scrollable: maxScroll > 0, value: maxScroll ? Math.round(1000 * window.scrollY / maxScroll) : 0 });
  }, []);

  const reveal = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 900);
  }, []);

  useEffect(() => {
    const onScroll = () => { update(); reveal(); };
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const frame = requestAnimationFrame(update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [reveal, update]);

  function scrollToPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || !metrics.scrollable) return;
    const maxThumbTop = Math.max(1, rect.height - metrics.thumb);
    const thumbTop = Math.max(0, Math.min(maxThumbTop, event.clientY - rect.top - metrics.thumb / 2));
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, maxScroll * thumbTop / maxThumbTop);
    reveal();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const page = Math.max(48, window.innerHeight * 0.85);
    const movements: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      window.scrollTo(0, event.key === "Home" ? 0 : document.documentElement.scrollHeight);
      return;
    }
    if (event.key in movements) {
      event.preventDefault();
      window.scrollBy(0, movements[event.key]);
    }
  }

  return <div
    ref={track}
    className="floating-scrollbar"
    data-visible={visible || undefined}
    role="scrollbar"
    aria-label="页面滚动位置"
    aria-controls="main"
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={1000}
    aria-valuenow={metrics.value}
    tabIndex={metrics.scrollable ? 0 : -1}
    onPointerEnter={() => setVisible(true)}
    onPointerLeave={() => { if (dragPointer.current === null) setVisible(false); }}
    onPointerDown={(event) => { dragPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); scrollToPointer(event); }}
    onPointerMove={(event) => { if (dragPointer.current === event.pointerId && event.buttons) scrollToPointer(event); }}
    onPointerUp={(event) => { dragPointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); reveal(); }}
    onPointerCancel={() => { dragPointer.current = null; }}
    onFocus={() => setVisible(true)}
    onBlur={() => setVisible(false)}
    onKeyDown={handleKeyDown}
    style={{ top: "18vh", height: "64vh", pointerEvents: metrics.scrollable ? "auto" : "none" }}
  ><span className="floating-scrollbar-thumb" style={{ top: metrics.top, height: metrics.thumb }} /></div>;
}
