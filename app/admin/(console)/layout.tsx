import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "@/app/admin/_components/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return <AdminShell session={session}>{children}</AdminShell>;
}
