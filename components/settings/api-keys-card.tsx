"use client";

import { Copy, Key, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import useSWR from "swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ApiKeyRow = {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type ListResponse = { ok: true; apiKeys: ApiKeyRow[] };

type CreatedKey = {
  id: string;
  label: string;
  prefix: string;
  expiresAt: string | null;
  secret: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function statusBadge(row: ApiKeyRow) {
  if (row.revokedAt) return <Badge variant="destructive">Revogada</Badge>;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    return <Badge variant="destructive">Expirada</Badge>;
  }
  return <Badge>Ativa</Badge>;
}

export function ApiKeysCard() {
  const { data, mutate } = useSWR<ListResponse>("/api/settings/api-keys");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const label = String(formData.get("label") ?? "").trim();

    startTransition(async () => {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Nao foi possivel criar a chave.");
        return;
      }

      form.reset();
      setCreated(payload.apiKey as CreatedKey);
      await mutate();
    });
  }

  function revokeKey() {
    if (!revoking) return;
    const target = revoking;
    startTransition(async () => {
      const response = await fetch(`/api/settings/api-keys/${target.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Nao foi possivel revogar a chave.");
        return;
      }

      setRevoking(null);
      await mutate();
    });
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopyHint("Segredo copiado.");
      setTimeout(() => setCopyHint(null), 1800);
    } catch {
      setCopyHint("Falha ao copiar.");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Nova API key</CardTitle>
          <CardDescription>
            O segredo so aparece uma vez. Copie e armazene num cofre seguro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={createKey}>
            <div className="space-y-2">
              <Label htmlFor="label">Rotulo</Label>
              <Input id="label" name="label" placeholder="Sistema XYZ — producao" required minLength={2} maxLength={80} />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={pending} className="cursor-pointer">
              <Key className="size-4" />
              {pending ? "Gerando..." : "Gerar chave"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chaves existentes</CardTitle>
          <CardDescription>Use no cabecalho Authorization: Bearer &lt;chave&gt;.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rotulo</TableHead>
                <TableHead>Prefixo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ultimo uso</TableHead>
                <TableHead>Criada</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.apiKeys ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="font-mono text-xs">{row.prefix}…</TableCell>
                  <TableCell>{statusBadge(row)}</TableCell>
                  <TableCell>{formatDate(row.lastUsedAt)}</TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    {row.revokedAt ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 cursor-pointer"
                        aria-label="Revogar chave"
                        onClick={() => setRevoking(row)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(data?.apiKeys ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    Nenhuma chave criada.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(created)}
        onOpenChange={(open) => {
          if (!open) {
            setCreated(null);
            setCopyHint(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave criada</DialogTitle>
            <DialogDescription>
              Copie agora. Por seguranca, nao conseguiremos exibir o segredo novamente.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">
                {created.secret}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => copySecret(created.secret)}
                className="cursor-pointer"
              >
                <Copy className="size-4" />
                Copiar segredo
              </Button>
              {copyHint ? <p className="text-xs text-muted-foreground">{copyHint}</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)} className="cursor-pointer">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar API key?</DialogTitle>
            <DialogDescription>
              Aplicacoes usando essa chave perderao acesso imediatamente. A acao nao pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {revoking ? (
            <p className="text-sm">
              <span className="font-medium">{revoking.label}</span>{" "}
              <span className="font-mono text-xs text-muted-foreground">{revoking.prefix}…</span>
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)} className="cursor-pointer">
              Cancelar
            </Button>
            <Button variant="destructive" disabled={pending} onClick={revokeKey} className="cursor-pointer">
              {pending ? "Revogando..." : "Revogar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
