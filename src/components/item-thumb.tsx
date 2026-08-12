import { CupSoda } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface ItemThumbProps {
  readonly imageUrl?: string | null;
  readonly name: string;
  readonly className?: string;
}

/**
 * Small square thumbnail for an item: its uploaded image, or a CupSoda icon.
 *
 * Built on Avatar rather than a bare `<img>` so the fallback also covers a URL
 * that *fails*, not just one that is absent. A plain img with a dead src renders
 * the browser's broken-image glyph, which is what happened across the app while
 * the blob store was over quota and every `/api/files/items/...` returned 404.
 *
 * Sizing is the caller's, via `className` (default size-9).
 */
export function ItemThumb({ imageUrl, name, className }: ItemThumbProps) {
  return (
    <Avatar className={cn("size-9 shrink-0 rounded-lg", className)}>
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={name}
          className="rounded-lg object-cover"
        />
      )}
      <AvatarFallback className="rounded-lg bg-muted text-muted-foreground">
        <CupSoda className="size-4" />
      </AvatarFallback>
    </Avatar>
  );
}
