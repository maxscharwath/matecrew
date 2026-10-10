"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Remote taps travel normalized to 200 × 120; the terminal maps them to the app's pixels. */
const TAP_COLUMNS = 200;
const TAP_ROWS = 120;

/**
 * Turns clicks on the panel into taps in the device's logical coordinates,
 * and marks where each one landed; the engine resolves what it presses.
 */
export function ScreenControl({
  children,
  onTap,
  label,
}: {
  children: ReactNode;
  onTap: (x: number, y: number) => void;
  label: string;
}) {
  const [marks, setMarks] = useState<{ id: number; left: number; top: number }[]>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <div className="relative size-full">
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        className="absolute inset-0 cursor-crosshair rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height || event.detail === 0) return;
          const left = (event.clientX - rect.left) / rect.width;
          const top = (event.clientY - rect.top) / rect.height;
          onTap(
            Math.min(TAP_COLUMNS - 1, Math.max(0, Math.floor(left * TAP_COLUMNS))),
            Math.min(TAP_ROWS - 1, Math.max(0, Math.floor(top * TAP_ROWS))),
          );
          const id = next.current++;
          setMarks((current) => [...current, { id, left, top }]);
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            setMarks((current) => current.filter((mark) => mark.id !== id));
          }, 700);
          timers.current.add(timer);
        }}
      />
      {marks.map((mark) => (
        <span
          key={mark.id}
          aria-hidden
          style={{ left: `${mark.left * 100}%`, top: `${mark.top * 100}%` }}
          className="pointer-events-none absolute size-7 -translate-1/2 animate-ping rounded-full border-2 border-zinc-900/70 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
