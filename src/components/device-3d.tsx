"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Device3DSceneProps } from "@/components/device-3d-scene";
import { cn } from "@/lib/utils";

export type { Device3DScreen } from "@/components/device-3d-scene";

/**
 * Client boundary for the terminal in 3D.
 *
 * three.js, the model and the firmware's WebAssembly only load once the frame
 * comes near the viewport: the scene is a separate chunk (SSR off, it touches
 * `window`), mounted by an IntersectionObserver. Until then, and while the chunk
 * arrives, a placeholder keeps the frame's size.
 */
const Device3DScene = dynamic(() => import("@/components/device-3d-scene").then((m) => m.Device3DScene), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder() {
  const t = useTranslations("devices.terminal3d");
  return (
    <div className="flex size-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

/**
 * The terminal in 3D. Size it with `className`; pass `screen` to show a terminal the page already
 * runs, or `office` to run one on a real office's data.
 */
export function Device3D({ className, screen, office }: Readonly<Device3DSceneProps>) {
  const frame = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return (
    <div ref={frame} className={cn("relative", className)}>
      {near ? <Device3DScene screen={screen} office={office} /> : <Placeholder />}
    </div>
  );
}
