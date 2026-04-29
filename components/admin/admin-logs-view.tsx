"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;
const ANY = "__any__";

type LogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
};

type LogsResponse = {
  ok: true;
  logs: LogRow[];
  pagination: { total: number; limit: number; offset: number };
  facets: { actions: string[]; entityTypes: string[] };
};

export function AdminLogsView() {
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    user: "",
    since: "",
    until: "",
  });
  const [offset, setOffset] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.user) params.set("user", filters.user);
    if (filters.since) params.set("since", filters.since);
    if (filters.until) params.set("until", filters.until);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }, [filters, offset]);

  const { data, error, isLoading, mutate } = useSWR<LogsResponse>(
    `/api/admin/logs?${queryString}`,
    { keepPreviousData: true },
  );

  function updateFilter<K extends keyof typeof filters>(key: K, value: string) {
    setOffset(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setOffset(0);
    setFilters({ action: "", entityType: "", user: "", since: "", until: "" });
  }

  const total = data?.pagination.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Filtre por ação, tipo de entidade, usuário ou intervalo de datas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          <div className="space-y-2">
            <Label>Ação</Label>
            <Select
              value={filters.action || ANY}
              onValueChange={(value) => updateFilter("action", value === ANY ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todas</SelectItem>
                {data?.facets.actions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Entidade</Label>
            <Select
              value={filters.entityType || ANY}
              onValueChange={(value) => updateFilter("entityType", value === ANY ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todas</SelectItem>
                {data?.facets.entityTypes.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Usuário (email/nome)</Label>
            <Input
              value={filters.user}
              onChange={(event) => updateFilter("user", event.target.value)}
              placeholder="ex: design@webstar.studio"
            />
          </div>
          <div className="space-y-2">
            <Label>De</Label>
            <Input
              type="datetime-local"
              value={filters.since}
              onChange={(event) => updateFilter("since", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Até</Label>
            <Input
              type="datetime-local"
              value={filters.until}
              onChange={(event) => updateFilter("until", event.target.value)}
            />
          </div>
          <div className="md:col-span-3 xl:col-span-5 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={clearFilters} className="cursor-pointer">
              Limpar filtros
            </Button>
            <Button
              variant="outline"
              onClick={() => mutate()}
              className="cursor-pointer"
              disabled={isLoading}
            >
              <RefreshCw className="size-4" /> Recarregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Eventos</CardTitle>
            <CardDescription>
              {isLoading
                ? "Carregando..."
                : `${total} ${total === 1 ? "registro" : "registros"} (página ${page} de ${lastPage}).`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="cursor-pointer disabled:cursor-not-allowed"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="cursor-pointer disabled:cursor-not-allowed"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {error ? (
            <div className="px-6 py-8 text-sm text-destructive">
              Falha ao carregar logs. {String((error as Error)?.message ?? "")}
            </div>
          ) : isLoading && !data ? (
            <div className="space-y-2 px-6 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : data && data.logs.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground">
              Nenhum log encontrado para os filtros atuais.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Quando</TableHead>
                  <TableHead className="w-[200px]">Usuário</TableHead>
                  <TableHead className="w-[180px]">Ação</TableHead>
                  <TableHead className="w-[110px]">Entidade</TableHead>
                  <TableHead className="w-[160px]">Entity ID</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      {log.userEmail ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{log.userName ?? log.userEmail}</span>
                          {log.userName ? (
                            <span className="text-xs text-muted-foreground">{log.userEmail}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.entityType}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {log.entityId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <MetadataPreview value={log.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetadataPreview({ value }: { value: Record<string, unknown> }) {
  if (!value || Object.keys(value).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
        {summariseMetadata(value)}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function summariseMetadata(value: Record<string, unknown>) {
  const keys = Object.keys(value).slice(0, 4);
  return keys
    .map((key) => `${key}: ${truncate(String((value as Record<string, unknown>)[key]))}`)
    .join("  ·  ");
}

function truncate(text: string) {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
