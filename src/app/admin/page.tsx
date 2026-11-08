import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AdminDashboardClient } from "@/components/admin-dashboard-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return <AdminDashboardClient username={session.username} />;
}
