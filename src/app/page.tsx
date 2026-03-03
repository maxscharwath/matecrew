import { redirect } from "next/navigation";
import { getOptionalSession, getUserMemberships } from "@/lib/auth-utils";

export default async function Home() {
  const session = await getOptionalSession();

  if (!session) {
    redirect("/sign-in");
  }

  const memberships = await getUserMemberships(session.user.id);

  if (memberships.length === 0) {
    // User has no memberships — show a basic message
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">No Office</h1>
          <p className="mt-2 text-muted-foreground">
            You are not a member of any office. Please contact an admin.
          </p>
        </div>
      </div>
    );
  }

  redirect(`/org/${memberships[0].office.id}/dashboard`);
}
