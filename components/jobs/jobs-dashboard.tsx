"use client";

import Link from "next/link";
import useSWR from "swr";
import { useMemo, useState, useTransition } from "react";
import { MoreHorizontal, Plus, Search, Square, Trash2 } from "lucide-react";
import { jobStatusLabels, jobStatusTone } from "@/lib/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Job = {
  id: string;
  status: keyof typeof jobStatusLabels;
  createdAt: string;
  file?: { fileName: string } | null;
  tiss?: { providerName?: string | null; batchNumber?: string | null; totalAmount?: string | null } | null;
};

type JobsResponse = {
  ok: true;
  jobs: Job[];
};

type StatusFilter = "all" | keyof typeof jobStatusLabels;

const stoppableStatuses = new Set<Job["status"]>([
  "uploaded",
  "awaiting_validation",
  "approved",
  "running",
]);

export function JobsDashboard() {
  const { data, isLoading, mutate } = useSWR<JobsResponse>("/api/jobs", { refreshInterval: 5000 });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ job: Job; action: "stop" | "delete" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const { awaiting, running, succeeded } = useMemo(
    () =>
      jobs.reduce(
        (acc, job) => {
          if (job.status === "awaiting_validation") acc.awaiting++;
          else if (job.status === "running") acc.running++;
          else if (job.status === "login_succeeded") acc.succeeded++;
          return acc;
        },
        { awaiting: 0, running: 0, succeeded: 0 },
      ),
    [jobs],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (!term) return true;
      const haystack = [
        job.file?.fileName ?? "",
        job.tiss?.providerName ?? "",
        job.tiss?.batchNumber ?? "",
        job.id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [jobs, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground">Acompanhe uploads, validacoes e logins Orizon.</p>
        </div>
        <Button asChild>
          <Link href="/app/jobs/new">
            <Plus className="size-4" />
            Novo job
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Aguardando validacao" value={awaiting} />
        <MetricCard label="Executando" value={running} />
        <MetricCard label="Lotes enviados" value={succeeded} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Historico</CardTitle>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 md:w-72"
                placeholder="Buscar por arquivo, prestador ou lote"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="md:w-56">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {(Object.keys(jobStatusLabels) as Array<keyof typeof jobStatusLabels>).map((key) => (
                  <SelectItem key={key} value={key}>
                    {jobStatusLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {actionError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prestador</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/jobs/${job.id}`}>
                        {job.file?.fileName ?? job.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={jobStatusTone[job.status]}>{jobStatusLabels[job.status]}</Badge>
                    </TableCell>
                    <TableCell>{job.tiss?.providerName ?? "-"}</TableCell>
                    <TableCell>{job.tiss?.batchNumber ?? "-"}</TableCell>
                    <TableCell>{job.tiss?.totalAmount ?? "-"}</TableCell>
                    <TableCell>
                      <RowActions
                        job={job}
                        onStop={() => {
                          setActionError(null);
                          setConfirm({ job, action: "stop" });
                        }}
                        onDelete={() => {
                          setActionError(null);
                          setConfirm({ job, action: "delete" });
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {jobs.length === 0 ? "Nenhum job criado." : "Nenhum job encontrado para o filtro atual."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onError={setActionError}
        onSuccess={() => mutate()}
      />
    </div>
  );
}

function RowActions({
  job,
  onStop,
  onDelete,
}: {
  job: Job;
  onStop: () => void;
  onDelete: () => void;
}) {
  const canStop = stoppableStatuses.has(job.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 cursor-pointer" aria-label="Acoes">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!canStop} onSelect={onStop}>
          <Square className="size-4" />
          Parar job
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <Trash2 className="size-4" />
          Excluir job
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConfirmDialog({
  confirm,
  onClose,
  onError,
  onSuccess,
}: {
  confirm: { job: Job; action: "stop" | "delete" } | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function run() {
    if (!confirm) return;
    const { job, action } = confirm;
    const url =
      action === "stop"
        ? `/api/jobs/${job.id}/stop`
        : `/api/jobs/${job.id}`;
    const method = action === "stop" ? "POST" : "DELETE";

    startTransition(async () => {
      const response = await fetch(url, { method });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        onError(
          payload?.error?.message ??
            (action === "stop" ? "Nao foi possivel parar o job." : "Nao foi possivel excluir o job."),
        );
        onClose();
        return;
      }

      onSuccess();
      onClose();
    });
  }

  const isStop = confirm?.action === "stop";
  const fileName = confirm?.job.file?.fileName ?? confirm?.job.id ?? "";

  return (
    <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isStop ? "Parar job" : "Excluir job"}</DialogTitle>
          <DialogDescription>
            {isStop
              ? `O workflow sera cancelado e o job marcado como falhou. (${fileName})`
              : `O job e seu historico serao removidos permanentemente. (${fileName})`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant={isStop ? "default" : "destructive"}
            onClick={run}
            disabled={isPending}
          >
            {isPending ? "Processando..." : isStop ? "Parar job" : "Excluir job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
