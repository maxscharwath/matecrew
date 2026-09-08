"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import type { MateCan3DProps } from "@/components/mate-can-3d";
import { DEFAULT_LABEL } from "@/lib/mate-label";

/**
 * Client boundary for the 3D can.
 *
 * Three.js and react-three-fiber touch `window` on import, so the scene is
 * loaded with SSR off — and lazily, so the renderer and texture only ship to
 * a page that actually shows the can. The placeholder keeps the frame from
 * collapsing while the chunk arrives; the logo variant stays blank instead,
 * because a spinner in a 36px brand tile is noise.
 *
 * Every can wears the default label unless a scene decides otherwise — the
 * games do, at random.
 */
const MateCan3D = dynamic(
  () => import("@/components/mate-can-3d").then((m) => m.MateCan3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    ),
  },
);

const MateCan3DQuiet = dynamic(
  () => import("@/components/mate-can-3d").then((m) => m.MateCan3D),
  { ssr: false },
);

type Props = Omit<MateCan3DProps, "label"> & Partial<Pick<MateCan3DProps, "label">>;

/** The hero can: interactive, with the fly-in. Size it with `className`. */
export function MateCan({ label = DEFAULT_LABEL, ...props }: Props) {
  return <MateCan3D {...props} label={label} />;
}

/** The can as a logo: small, non-interactive, always turning. */
export function MateCanLogo({ className }: { readonly className?: string }) {
  return (
    <MateCan3DQuiet
      className={className}
      detail="icon"
      interactive={false}
      intro={false}
      label={DEFAULT_LABEL}
    />
  );
}
