import { redirect } from "next/navigation";

/**
 * Public registration is disabled on this self-hosted dashboard.
 * The admin account already exists — sign in instead.
 */
export default function RegisterPage() {
  redirect("/login");
}
