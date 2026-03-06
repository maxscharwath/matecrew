import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { MembersTable } from "@/components/members-table";
import { PendingRequestsCard } from "@/components/pending-requests-card";
import { DataPagination } from "@/components/pagination";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

interface SectionProps {
  readonly officeId: string;
  readonly currentUserId: string;
  readonly page: number;
}

// ── Skeleton fallbacks ───────────────────────────────────

export function PendingRequestsFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-md border px-3 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1 h-3 w-44" />
              </div>
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function MembersTableFallback() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border px-3 py-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-1 h-3 w-44" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Async sections ───────────────────────────────────────

export async function PendingRequestsSection({ officeId }: { readonly officeId: string }) {
  const pendingRequests = await prisma.joinRequest.findMany({
    where: { officeId, status: "PENDING" },
    include: { user: { select: { name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const pendingRequestRows = await Promise.all(
    pendingRequests.map(async (r) => ({
      id: r.id,
      userName: r.user.name,
      userEmail: r.user.email,
      avatarUrl: await resolveAvatarUrl(r.user.image),
      createdAt: r.createdAt.toISOString(),
    }))
  );

  return <PendingRequestsCard officeId={officeId} requests={pendingRequestRows} />;
}

export async function MembersTableSection({ officeId, currentUserId, page }: SectionProps) {
  const [memberships, memberCount] = await Promise.all([
    prisma.membership.findMany({
      where: { officeId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { user: { name: "asc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.membership.count({ where: { officeId } }),
  ]);

  const members = await Promise.all(
    memberships.map(async (m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: await resolveAvatarUrl(m.user.image),
      roles: ([...m.roles] as ("ADMIN" | "USER")[]).sort((a, b) => a.localeCompare(b)),
    }))
  );

  return (
    <div className="space-y-3">
      <MembersTable
        officeId={officeId}
        members={members}
        currentUserId={currentUserId}
      />
      <DataPagination totalItems={memberCount} pageSize={PAGE_SIZE} />
    </div>
  );
}
