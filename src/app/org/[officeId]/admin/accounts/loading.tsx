import { Skeleton } from "@/components/ui/skeleton";
import { DuplicatesFallback } from "./_sections";

export default function AccountsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <DuplicatesFallback />
    </div>
  );
}
