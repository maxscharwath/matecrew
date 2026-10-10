"use client";

import { useEffect, useState } from "react";
import { deviceScreen } from "@/lib/device/contract";
import { DeviceWasm } from "@/lib/device/virtual/wasm";
import { FrameCanvas } from "./frame-canvas";

/** Preview a server definition on the client using the firmware's Rust renderer. */
export function ScreenPreview({ url, placeholder }: { url: string; placeholder: string }) {
  const [bits, setBits] = useState<Uint8Array | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      DeviceWasm.load(),
      fetch(url, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(`Screen definition: ${response.status}`);
        return deviceScreen.parse(await response.json());
      }),
    ]).then(([wasm, data]) => {
      if (!controller.signal.aborted) setBits(wasm.render({ type: "dashboard", data, offline: false }));
    }).catch(() => { /* Keep the translated placeholder if the preview is unavailable. */ });
    return () => controller.abort();
  }, [url]);
  return bits ? <FrameCanvas bits={bits} refreshes={1} full={false} /> : <div className="grid size-full place-items-center text-sm text-zinc-500">{placeholder}</div>;
}
