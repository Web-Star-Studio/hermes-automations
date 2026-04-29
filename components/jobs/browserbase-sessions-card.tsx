"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, MonitorPlay } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

const BrowserbaseReplay = dynamic(
  () => import("@/components/jobs/browserbase-replay").then((m) => m.BrowserbaseReplay),
  { ssr: false, loading: () => <Skeleton className="h-[360px] w-full" /> },
);

type RemoteSession = {
  id: string;
  status: string | null;
  region: string | null;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string | null;
  durationSeconds: number | null;
} | null;

type SessionEntry = {
  id: string;
  firstSeen: string;
  portalStatus: string | null;
  remote: RemoteSession;
};

type Response = {
  ok: true;
  sessions: SessionEntry[];
};

export function BrowserbaseSessionsCard({ jobId }: { jobId: string }) {
  const { data, isLoading } = useSWR<Response>(`/api/jobs/${jobId}/portal-sessions`);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Collapsible defaultOpen={false}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="group flex cursor-pointer flex-row items-start justify-between gap-2 select-none">
            <div className="space-y-1">
              <CardTitle>Sessões Browserbase</CardTitle>
              <CardDescription>
                {isLoading
                  ? "Carregando..."
                  : `${data?.sessions.length ?? 0} sessão(ões) de browser. Replays ficam disponíveis após o fim de cada sessão.`}
              </CardDescription>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !data?.sessions.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma sessão Browserbase registrada para este job.
              </p>
            ) : (
              data.sessions.map((entry) => (
                <SessionRow
                  key={entry.id}
                  entry={entry}
                  expanded={openId === entry.id}
                  onToggle={() => setOpenId((curr) => (curr === entry.id ? null : entry.id))}
                />
              ))
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function SessionRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: SessionEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const remote = entry.remote;
  const isCompleted =
    remote?.status === "COMPLETED" || remote?.endedAt != null || entry.portalStatus === "closed";

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-2 text-left hover:bg-muted/30"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm">
            <MonitorPlay className="size-4 text-muted-foreground" />
            <span className="font-mono text-xs">{entry.id}</span>
            {remote?.status ? (
              <Badge variant="outline" className="text-[10px]">
                {remote.status}
              </Badge>
            ) : null}
            {remote?.region ? (
              <Badge variant="secondary" className="text-[10px]">
                {remote.region}
              </Badge>
            ) : null}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Iniciada {formatDateTime(remote?.startedAt ?? entry.firstSeen)}
            {remote?.durationSeconds != null
              ? ` · ${formatDuration(remote.durationSeconds)}`
              : ""}
          </div>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded ? (
        <div className="border-t px-3 py-3">
          {isCompleted ? (
            <BrowserbaseReplay sessionId={entry.id} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Replay só fica disponível depois que a sessão é encerrada.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m${rem}s`;
}
