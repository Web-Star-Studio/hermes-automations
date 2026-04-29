"use client";

import { useMemo, useState, useTransition } from "react";
import useSWR from "swr";
import { Ban, Check, RefreshCw, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

const ANY = "__any__";

type UserStatus = "pending" | "approved" | "rejected";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  jobCount: number;
};

type UsersResponse = {
  ok: true;
  users: AdminUser[];
  statuses: UserStatus[];
};

const statusLabel: Record<UserStatus, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Bloqueado",
};

const statusVariant: Record<UserStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function AdminUsersView() {
  const [filters, setFilters] = useState({ status: "pending", q: "" });
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.q) params.set("q", filters.q);
    return params.toString();
  }, [filters]);

  const { data, isLoading, mutate } = useSWR<UsersResponse>(
    `/api/admin/users?${queryString}`,
    { keepPreviousData: true },
  );

  function updateStatus(userId: string, status: UserStatus) {
    setError(null);
    setPendingId(userId);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/users/${userId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          setError(payload?.error?.message ?? "Falha ao atualizar status.");
          return;
        }
        await mutate();
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Por padrão exibe apenas cadastros aguardando aprovação.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={filters.status || ANY}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value === ANY ? "" : value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
                <SelectItem value="rejected">Bloqueado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label>Buscar (nome/email)</Label>
            <Input
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              placeholder="ex: maria@clinica.com"
            />
          </div>
          <div className="flex items-end justify-end">
            <Button
              variant="outline"
              onClick={() => mutate()}
              disabled={isLoading}
              className="cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw className="size-4" />
              Recarregar
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cadastros</CardTitle>
          <CardDescription>
            {isLoading
              ? "Carregando..."
              : `${data?.users.length ?? 0} ${data?.users.length === 1 ? "usuário" : "usuários"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {isLoading && !data ? (
            <div className="space-y-2 px-6 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : data?.users.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-sm text-muted-foreground">
              <ShieldQuestion className="size-6" />
              <p>Nenhum usuário com esses filtros.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[80px] text-right">Jobs</TableHead>
                  <TableHead className="w-[170px]">Cadastro</TableHead>
                  <TableHead className="w-[260px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.users.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{row.name || "—"}</span>
                        <span className="text-xs text-muted-foreground">{row.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[row.status]}>{statusLabel[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.jobCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {row.status !== "approved" ? (
                          <Button
                            size="sm"
                            variant="default"
                            disabled={pendingId === row.id}
                            onClick={() => updateStatus(row.id, "approved")}
                            className="cursor-pointer disabled:cursor-not-allowed"
                          >
                            <Check className="size-4" /> Aprovar
                          </Button>
                        ) : null}
                        {row.status !== "rejected" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingId === row.id}
                            onClick={() => updateStatus(row.id, "rejected")}
                            className="cursor-pointer disabled:cursor-not-allowed"
                          >
                            <Ban className="size-4" /> Bloquear
                          </Button>
                        ) : null}
                        {row.status === "rejected" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pendingId === row.id}
                            onClick={() => updateStatus(row.id, "pending")}
                            className="cursor-pointer disabled:cursor-not-allowed"
                          >
                            Reverter para pendente
                          </Button>
                        ) : null}
                      </div>
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

function formatDateTime(value: string) {
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
