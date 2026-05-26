import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { isPasswordAuthEnabled } from "@/lib/oauth-providers";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isPasswordAuthEnabled()) redirect("/sign-in");
  const { token } = await searchParams;
  return <ResetPasswordForm token={token ?? null} />;
}
