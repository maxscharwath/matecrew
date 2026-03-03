import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth-utils";

export default async function Home() {
  const session = await getOptionalSession();

  if (session) {
    redirect("/dashboard");
  } else {
    redirect("/sign-in");
  }
}
