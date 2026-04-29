import { requireAdminPageSession } from "@/lib/auth/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPageSession();
  return <>{children}</>;
}
