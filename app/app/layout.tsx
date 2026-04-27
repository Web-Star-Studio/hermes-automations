import { AppShell } from "@/components/layout/app-shell";
import { requirePageSession } from "@/lib/session";

export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession();

  return <AppShell session={session}>{children}</AppShell>;
}
