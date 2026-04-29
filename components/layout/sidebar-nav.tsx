"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, ScrollText, Settings } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Briefcase;
  match: (pathname: string) => boolean;
};

const PRIMARY_ITEMS: NavItem[] = [
  {
    href: "/app/jobs",
    label: "Jobs",
    icon: Briefcase,
    match: (pathname) => pathname === "/app/jobs" || pathname.startsWith("/app/jobs/"),
  },
];

const ADMIN_ITEMS: NavItem[] = [
  {
    href: "/app/admin/logs",
    label: "Logs",
    icon: ScrollText,
    match: (pathname) => pathname.startsWith("/app/admin/logs"),
  },
];

const FOOTER_ITEMS: NavItem[] = [
  {
    href: "/app/settings/platforms",
    label: "Configuracoes",
    icon: Settings,
    match: (pathname) => pathname.startsWith("/app/settings"),
  },
];

function NavList({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";

  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
              <Link href={item.href}>
                <Icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function SidebarPrimaryNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const items = isAdmin ? [...PRIMARY_ITEMS, ...ADMIN_ITEMS] : PRIMARY_ITEMS;
  return <NavList items={items} />;
}

export function SidebarFooterNav() {
  return <NavList items={FOOTER_ITEMS} />;
}
