import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { isPasswordAuthEnabled } from "@/lib/oauth-providers";

export default function ForgotPasswordPage() {
  if (!isPasswordAuthEnabled()) redirect("/sign-in");
  return <ForgotPasswordForm />;
}
