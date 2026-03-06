import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function RequestLoading() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="space-y-6">
        {/* Title + date */}
        <div className="text-center">
          <Skeleton className="mx-auto h-8 w-56" />
          <Skeleton className="mx-auto mt-2 h-5 w-40" />
        </div>

        {/* Session info */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-4 w-36" />
          </CardContent>
        </Card>

        {/* Other requesters */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
