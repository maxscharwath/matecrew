"use client";
import type { ReactNode } from "react";

/** Translate console clicks into the device's logical coordinates; the engine resolves the action. */
export function ScreenControl({
  children,
  onTap,
  label,
}: {
  children: ReactNode;
  onTap: (x: number, y: number) => void;
  label: string;
}) {
  return (
    <div className="relative size-full">
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        className="absolute inset-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height || event.detail === 0) return;
          onTap(
            Math.min(
              199,
              Math.max(
                0,
                Math.floor(((event.clientX - rect.left) * 200) / rect.width),
              ),
            ),
            Math.min(
              119,
              Math.max(
                0,
                Math.floor(((event.clientY - rect.top) * 120) / rect.height),
              ),
            ),
          );
        }}
      />
    </div>
  );
}
