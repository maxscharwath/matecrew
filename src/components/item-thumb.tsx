import { CupSoda } from "lucide-react";
import { cn } from "@/lib/utils";

interface ItemThumbProps {
  readonly imageUrl?: string | null;
  readonly name: string;
  readonly className?: string;
}

/**
 * Small square thumbnail for an item: its uploaded image, or a CupSoda icon
 * fallback. Sizing is controlled by the caller via `className` (default size-9).
 */
export function ItemThumb({ imageUrl, name, className }: ItemThumbProps) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        className={cn("size-9 shrink-0 rounded-lg object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
        className,
      )}
    >
      <CupSoda className="size-4" />
    </div>
  );
}
