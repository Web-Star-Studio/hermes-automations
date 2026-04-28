"use client";

import useSWR from "swr";
import { KeyRound, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Credential = {
  id: string;
  platformId: string;
  label: string;
  usernameMasked: string;
  createdAt: string;
};

type CredentialsResponse = {
  ok: true;
  credentials: Credential[];
};

export function PlatformSettings() {
  const { data, mutate } = useSWR<CredentialsResponse>("/api/settings/platform-credentials");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Credential | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function createCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    setSuccess(null);

    const formData = new FormData(form);
    const payloadBody = JSON.stringify({
      platformId: "orizon_fature",
      label: String(formData.get("label") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
    });

    startTransition(async () => {
      const response = await fetch("/api/settings/platform-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadBody,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Não foi possível salvar a credencial.");
        return;
      }

      form.reset();
      setSuccess("Credencial salva.");
      await mutate();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plataformas</h1>
        <p className="text-sm text-muted-foreground">Configure acessos usados pelo agente de browser.</p>
      </div>

      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="platforms">Plataformas</TabsTrigger>
          <TabsTrigger value="credentials">Credenciais</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
        </TabsList>
        <TabsContent value="platforms" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Orizon Fature</CardTitle>
              <CardDescription>Plataforma inicial suportada pelo MVP.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Badge>Ativa</Badge>
              <span className="text-sm text-muted-foreground">Login automatizado até a autenticação.</span>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="credentials" className="grid gap-4 pt-4 lg:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Nova credencial</CardTitle>
              <CardDescription>A senha será criptografada antes de salvar.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={createCredential}>
                <div className="space-y-2">
                  <Label htmlFor="label">Rótulo</Label>
                  <Input id="label" name="label" placeholder="Clínica principal" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Usuário Orizon</Label>
                  <Input id="username" name="username" autoComplete="username" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha Orizon</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" required />
                </div>
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {success ? (
                  <Alert>
                    <AlertDescription>{success}</AlertDescription>
                  </Alert>
                ) : null}
                <Button type="submit" disabled={isPending}>
                  <KeyRound className="size-4" />
                  {isPending ? "Salvando..." : "Salvar credencial"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credenciais salvas</CardTitle>
              <CardDescription>Senhas nunca são retornadas para o navegador.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rowError ? (
                <Alert variant="destructive">
                  <AlertDescription>{rowError}</AlertDescription>
                </Alert>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rótulo</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Plataforma</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.credentials ?? []).map((credential) => (
                    <TableRow key={credential.id}>
                      <TableCell>{credential.label}</TableCell>
                      <TableCell>{credential.usernameMasked}</TableCell>
                      <TableCell>Orizon Fature</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 cursor-pointer"
                              aria-label="Ações"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setRowError(null);
                                setEditing(credential);
                              }}
                            >
                              <Pencil className="size-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setRowError(null);
                                setDeleting(credential);
                              }}
                            >
                              <Trash2 className="size-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(data?.credentials ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        Nenhuma credencial salva.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="security" className="space-y-6 pt-4">
          <BrowserVisionToggle />
          <Card>
            <CardHeader>
              <CardTitle>Controles ativos</CardTitle>
              <CardDescription>Postura de segurança implementada no MVP.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Credenciais criptografadas com AES-256-GCM.</p>
              <p>Eventos e respostas de API nunca incluem senha.</p>
              <p>Jobs e credenciais são sempre filtrados pelo usuário autenticado.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditCredentialDialog
        credential={editing}
        onClose={() => setEditing(null)}
        onError={setRowError}
        onSuccess={() => mutate()}
      />

      <DeleteCredentialDialog
        credential={deleting}
        onClose={() => setDeleting(null)}
        onError={setRowError}
        onSuccess={() => mutate()}
      />
    </div>
  );
}

function EditCredentialDialog({
  credential,
  onClose,
  onError,
  onSuccess,
}: {
  credential: Credential | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credential) return;
    const form = event.currentTarget;
    setLocalError(null);

    const formData = new FormData(form);
    const label = String(formData.get("label") ?? "").trim();
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    const body: Record<string, string> = {};
    if (label && label !== credential.label) body.label = label;
    if (username && username !== credential.usernameMasked) body.username = username;
    if (password) body.password = password;

    if (Object.keys(body).length === 0) {
      setLocalError("Nenhuma alteração para salvar.");
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/settings/platform-credentials/${credential.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        setLocalError(payload?.error?.message ?? "Não foi possível atualizar a credencial.");
        return;
      }

      onSuccess();
      onClose();
    });
  }

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar credencial</DialogTitle>
          <DialogDescription>
            Altere rótulo, usuário ou senha. Deixe a senha em branco para manter a atual.
          </DialogDescription>
        </DialogHeader>
        {credential ? (
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="edit-label">Rótulo</Label>
              <Input id="edit-label" name="label" defaultValue={credential.label} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-username">Usuário Orizon</Label>
              <Input
                id="edit-username"
                name="username"
                autoComplete="username"
                placeholder={credential.usernameMasked}
              />
              <p className="text-xs text-muted-foreground">
                Atual: {credential.usernameMasked} (deixe em branco para manter).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">Nova senha Orizon</Label>
              <Input
                id="edit-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Deixe em branco para manter a senha atual"
              />
            </div>
            {localError ? (
              <Alert variant="destructive">
                <AlertDescription>{localError}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onError(null);
                  onClose();
                }}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Salvando..." : "Salvar alterações"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteCredentialDialog({
  credential,
  onClose,
  onError,
  onSuccess,
}: {
  credential: Credential | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function run() {
    if (!credential) return;
    startTransition(async () => {
      const response = await fetch(`/api/settings/platform-credentials/${credential.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        onError(payload?.error?.message ?? "Não foi possível excluir a credencial.");
        onClose();
        return;
      }

      onSuccess();
      onClose();
    });
  }

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir credencial</DialogTitle>
          <DialogDescription>
            A credencial &quot;{credential?.label}&quot; será removida permanentemente. Jobs anteriores que a
            usaram permanecem registrados.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={run} disabled={isPending}>
            {isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PreferencesResponse = {
  ok: true;
  preferences: { browserVisionEnabled: boolean };
};

function BrowserVisionToggle() {
  const { data, mutate } = useSWR<PreferencesResponse>("/api/settings/preferences");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const enabled = data?.preferences.browserVisionEnabled ?? false;

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserVisionEnabled: next }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Não foi possível atualizar a preferência.");
        return;
      }
      await mutate();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperação por visão (LLM)</CardTitle>
        <CardDescription>
          Quando o agente não encontra um elemento no portal pelo HTML, ele captura uma screenshot
          da viewport e pede a um modelo multimodal para localizar o alvo. Custa uma chamada de
          modelo por falha de localização e envia a imagem do portal ao provedor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="browser-vision-toggle" className="text-sm font-medium">
              Ativar recuperação por visão
            </Label>
            <p className="text-xs text-muted-foreground">
              Aplica-se aos seus jobs. Desativado por padrão para manter custo previsível e evitar
              envio de imagens do portal ao modelo.
            </p>
          </div>
          <Switch
            id="browser-vision-toggle"
            checked={enabled}
            disabled={isPending || !data}
            onCheckedChange={toggle}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
