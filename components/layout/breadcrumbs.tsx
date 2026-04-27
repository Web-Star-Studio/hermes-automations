"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  jobs: "Jobs",
  new: "Novo",
  settings: "Configuracoes",
  platforms: "Plataformas",
};

/** Layout-only segment; not shown in the trail. */
const APP_PREFIX = "app";

/**
 * Hrefs that are not real standalone pages (no `page.tsx`); show label only, no link.
 */
const HREF_NO_STANDALONE_PAGE = new Set<string>(["/app/settings"]);

function labelForSegment(segment: string, index: number, segments: string[]): string {
  const known = SEGMENT_LABELS[segment];
  if (known) return known;
  // Treat dynamic segments (like job IDs) as a short identifier.
  const prev = segments[index - 1];
  if (prev === "jobs") {
    return `Job ${segment.slice(0, 8)}`;
  }
  return segment;
}

export function Breadcrumbs() {
  const pathname = usePathname() ?? "/";
  const parts = pathname.split("/").filter(Boolean);
  const trail =
    parts[0] === APP_PREFIX ? parts.slice(1) : parts;

  if (trail.length === 0) {
    return null;
  }

  const crumbs = trail.map((segment, index) => {
    const href = `/${APP_PREFIX}/` + trail.slice(0, index + 1).join("/");
    return {
      href,
      label: labelForSegment(segment, index, trail),
      isLast: index === trail.length - 1,
    };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center text-sm text-muted-foreground">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center">
          {i > 0 ? (
            <ChevronRight className="mx-1.5 size-3.5 shrink-0 text-muted-foreground/60" />
          ) : null}
          {crumb.isLast ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : HREF_NO_STANDALONE_PAGE.has(crumb.href) ? (
            <span className="text-muted-foreground">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="transition-colors hover:text-foreground">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
