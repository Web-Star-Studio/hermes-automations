import Image from "next/image";
import Link from "next/link";
import type { Session } from "@/lib/auth";
import { isAdminSession } from "@/lib/auth/admin";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { SidebarFooterNav, SidebarPrimaryNav } from "@/components/layout/sidebar-nav";

function initialsFor(name?: string | null) {
  if (!name) return "US";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "US";
}

export function AppShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const displayName = session.user.name ?? session.user.email ?? "Usuario";
  const isAdmin = isAdminSession(session);

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <Link
            href="/app/jobs"
            className="flex w-full min-w-0 items-center justify-center px-2 py-1.5 group-data-[collapsible=icon]:px-0"
          >
            <span className="inline-block h-6 w-fit max-w-[9rem] shrink-0 group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-6">
              <Image
                src="/logo-wide-dark-8RRjJL03.png"
                alt="DOC365"
                width={192}
                height={40}
                className="h-6 w-auto max-w-full object-contain brightness-0 group-data-[collapsible=icon]:h-full group-data-[collapsible=icon]:w-full dark:brightness-0 dark:invert"
                priority
                sizes="(min-width: 768px) 9rem, 40vw"
              />
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarPrimaryNav isAdmin={isAdmin} />
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarGroup className="p-0">
            <SidebarFooterNav />
          </SidebarGroup>
          <SidebarSeparator />
          <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initialsFor(session.user.name)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{displayName}</span>
              <Separator orientation="vertical" className="ml-auto h-5" />
              <SignOutButton className="h-7 px-2 text-xs" />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Breadcrumbs />
        </header>
        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
