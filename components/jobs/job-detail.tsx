"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, Loader2, Wrench } from "lucide-react";
import { jobFlowLabels, jobStatusLabels, jobStatusTone } from "@/lib/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrowserbaseSessionsCard } from "@/components/jobs/browserbase-sessions-card";
import type { JobWorkflowEdge, JobWorkflowNode } from "@/lib/jobs/workflow-visualization";
import type { PendingStepRecovery } from "@/lib/db/schema";
import type { TissExpanded, TissGuideSummary, TissProcedureCode } from "@/lib/tiss/parser";

const JobWorkflowCanvas = dynamic(
  () => import("@/components/jobs/job-workflow-canvas").then((mod) => mod.JobWorkflowCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[520px] w-full" />,
  },
);

type AgentEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type JobDetailResponse = {
  ok: true;
  job: {
    id: string;
    status: keyof typeof jobStatusLabels;
    flowType: keyof typeof jobFlowLabels;
    runId: string | null;
    errorMessage: string | null;
    pendingStepRecovery: PendingStepRecovery | null;
  };
  file: { fileName: string; size: string; checksum: string } | null;
  files: Array<{ id: string; fileName: string; size: string; checksum: string; contentType: string }>;
  tiss: {
    standardVersion: string | null;
    transactionType: string | null;
    providerName: string | null;
    providerRegister: string | null;
    operatorRegister: string | null;
    batchNumber: string | null;
    guideCount: string;
    totalAmount: string | null;
    beneficiaryNames: string[];
    rawSummary: { expanded?: TissExpanded } | null;
  } | null;
  events: AgentEvent[];
  workflow: {
    nodes: JobWorkflowNode[];
    edges: JobWorkflowEdge[];
    activeNodeId: string;
    agentEvents: AgentEvent[];
  };
};

type CredentialsResponse = {
  ok: true;
  credentials: Array<{
    id: string;
    label: string;
    usernameMasked: string;
    platformId: string;
  }>;
};

export function JobDetail({ jobId }: { jobId: string }) {
  const { data, isLoading, mutate } = useSWR<JobDetailResponse>(`/api/jobs/${jobId}`, {
    refreshInterval: 3000,
  });
  const { data: credentialsData } = useSWR<CredentialsResponse>("/api/settings/platform-credentials");
  const [credentialId, setCredentialId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const credentials = useMemo(
    () => credentialsData?.credentials.filter((item) => item.platformId === "orizon_fature") ?? [],
    [credentialsData],
  );

  if (isLoading || !data) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const editable = data.job.status === "awaiting_validation";
  const expanded = data.tiss?.rawSummary?.expanded ?? null;
  const timelineEvents = data.workflow.agentEvents.length ? data.workflow.agentEvents : data.events;

  function approve() {
    setError(null);

    const validatedData = {
      standardVersion: data?.tiss?.standardVersion,
      transactionType: data?.tiss?.transactionType,
      providerName: data?.tiss?.providerName,
      providerRegister: data?.tiss?.providerRegister,
      operatorRegister: data?.tiss?.operatorRegister,
      batchNumber: data?.tiss?.batchNumber,
      guideCount: data?.tiss?.guideCount,
      totalAmount: data?.tiss?.totalAmount,
      beneficiaryNames: data?.tiss?.beneficiaryNames ?? [],
    };

    startTransition(async () => {
      const response = await fetch(`/api/jobs/${jobId}/resume-validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: "orizon_fature",
          platformCredentialId: credentialId,
          validatedData,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Não foi possível iniciar o job.");
        return;
      }

      await mutate();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.files.length > 1
              ? `${data.files.length} arquivos TISS`
              : data.file?.fileName ?? "Job TISS"}
          </h1>
          <p className="text-sm text-muted-foreground">Job {data.job.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{jobFlowLabels[data.job.flowType]}</Badge>
          <Badge variant={jobStatusTone[data.job.status]}>{jobStatusLabels[data.job.status]}</Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Validação TISS</CardTitle>
                <CardDescription>Dados extraídos deterministicamente do XML.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {data.tiss ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <ReadOnlyField label="Versão TISS" value={data.tiss.standardVersion} />
                    <ReadOnlyField label="Transação" value={expanded?.tipoFaturamento ?? data.tiss.transactionType} />
                    <ReadOnlyField label="Prestador" value={data.tiss.providerName} />
                    <ReadOnlyField label="Registro prestador" value={data.tiss.providerRegister} />
                    <ReadOnlyField label="Registro operadora" value={data.tiss.operatorRegister} />
                    <ReadOnlyField label="Lote" value={data.tiss.batchNumber} />
                    <ReadOnlyField label="Guias" value={data.tiss.guideCount} />
                    <ReadOnlyField label="Valor total" value={formatCurrency(data.tiss.totalAmount)} />
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>O workflow ainda está extraindo o XML.</AlertDescription>
                  </Alert>
                )}

                <Separator />

                <div className="space-y-3">
                  <Label>Plataforma</Label>
                  <Input value="Orizon Fature" disabled />
                </div>
                <div className="space-y-3">
                  <Label>Credencial</Label>
                  <Select value={credentialId} onValueChange={setCredentialId} disabled={!editable}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma credencial Orizon" />
                    </SelectTrigger>
                    <SelectContent>
                      {credentials.map((credential) => (
                        <SelectItem key={credential.id} value={credential.id}>
                          {credential.label} ({credential.usernameMasked})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button disabled={!editable || !credentialId || isPending} onClick={approve}>
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Validar e iniciar job
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <BatchDetails expanded={expanded} />
              <FilesAttached files={data.files} expandedFiles={expanded?.files ?? null} />
              <FinancialBreakdown expanded={expanded} totalFromHeader={data.tiss?.totalAmount ?? null} />
              <ProcedureCodes codes={expanded?.procedureCodes ?? []} totalProcedures={expanded?.procedureCount ?? 0} />
              <BeneficiariesAndGuides
                guides={expanded?.guides ?? []}
                beneficiaries={data.tiss?.beneficiaryNames ?? []}
              />
            </div>
          </div>

          {data.job.pendingStepRecovery && data.job.status === "awaiting_recovery" ? (
            <StepRecoveryPanel
              jobId={jobId}
              pending={data.job.pendingStepRecovery}
              onResolved={() => mutate()}
            />
          ) : null}

          <AgentTimeline events={timelineEvents} />
          <BrowserbaseSessionsCard jobId={jobId} />
        </TabsContent>

        <TabsContent value="workflow" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Workflow agêntico</CardTitle>
              <CardDescription>Estado vivo do agente, tools e validação humana.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <JobWorkflowCanvas
                activeNodeId={data.workflow.activeNodeId}
                edges={data.workflow.edges}
                nodes={data.workflow.nodes}
              />
              {data.job.errorMessage ? (
                <Alert variant="destructive">
                  <AlertDescription>{data.job.errorMessage}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilesAttached({
  files,
  expandedFiles,
}: {
  files: Array<{ id: string; fileName: string; size: string; contentType: string }>;
  expandedFiles: NonNullable<TissExpanded["files"]> | null;
}) {
  if (files.length <= 1) return null;
  // Match each jobFile with its parsed breakdown (when present) by filename.
  const breakdown = new Map(
    (expandedFiles ?? []).map((f) => [
      f.fileName,
      { guideCount: f.guideCount, totalAmount: f.totalAmount, batchNumber: f.batchNumber },
    ]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Arquivos do envio</CardTitle>
        <CardDescription>{files.length} arquivos serão enviados juntos no mesmo lote do portal.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead>Guias</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => {
              const bd = breakdown.get(file.fileName);
              return (
                <TableRow key={file.id}>
                  <TableCell className="max-w-[280px] truncate text-sm">{file.fileName}</TableCell>
                  <TableCell className="font-mono text-xs">{bd?.batchNumber ?? "—"}</TableCell>
                  <TableCell>{bd?.guideCount ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(bd?.totalAmount ?? null)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BatchDetails({ expanded }: { expanded: TissExpanded | null }) {
  if (!expanded) return null;
  const hasAny =
    expanded.competencia ||
    expanded.dataInicialFaturamento ||
    expanded.dataFinalFaturamento ||
    expanded.dataEnvioLote ||
    expanded.guideTypes.length;

  if (!hasAny) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detalhes do lote</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <ReadOnlyField label="Competência" value={expanded.competencia} />
        <ReadOnlyField label="Data de envio" value={formatDate(expanded.dataEnvioLote)} />
        <ReadOnlyField label="Início faturamento" value={formatDate(expanded.dataInicialFaturamento)} />
        <ReadOnlyField label="Fim faturamento" value={formatDate(expanded.dataFinalFaturamento)} />
        <div className="space-y-2 md:col-span-2">
          <Label>Tipos de guia</Label>
          <div className="flex flex-wrap gap-2">
            {expanded.guideTypes.length === 0 ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              expanded.guideTypes.map((type) => (
                <Badge key={type} variant="secondary">
                  {type}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FinancialBreakdown({
  expanded,
  totalFromHeader,
}: {
  expanded: TissExpanded | null;
  totalFromHeader: string | null;
}) {
  const amounts = expanded?.amounts;
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Procedimentos", value: amounts?.procedimentos ?? null },
    { label: "Diárias", value: amounts?.diarias ?? null },
    { label: "Materiais", value: amounts?.materiais ?? null },
    { label: "Medicamentos", value: amounts?.medicamentos ?? null },
    { label: "Taxas e aluguéis", value: amounts?.taxasAlugueis ?? null },
    { label: "Gases medicinais", value: amounts?.gases ?? null },
  ];
  const filled = rows.filter((row) => row.value);
  const total = amounts?.total ?? totalFromHeader;

  if (filled.length === 0 && !total) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo financeiro</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {filled.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between rounded-md border p-3">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="font-medium">{formatCurrency(row.value)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-baseline justify-between rounded-md border-2 border-primary/40 bg-primary/5 p-3">
          <span className="text-sm font-medium">Total geral</span>
          <span className="text-lg font-semibold">{formatCurrency(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProcedureCodes({ codes, totalProcedures }: { codes: TissProcedureCode[]; totalProcedures: number }) {
  if (codes.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Procedimentos</CardTitle>
        <CardDescription>{totalProcedures} procedimentos em {codes.length} códigos TUSS distintos.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {codes.map((code) => (
            <Badge key={code.codigo} variant="outline" className="font-mono">
              {code.codigo} · {code.count}x
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BeneficiariesAndGuides({
  guides,
  beneficiaries,
}: {
  guides: TissGuideSummary[];
  beneficiaries: string[];
}) {
  if (guides.length === 0 && beneficiaries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guias do lote</CardTitle>
        <CardDescription>
          {guides.length > 0
            ? `Mostrando ${guides.length} guia${guides.length > 1 ? "s" : ""}.`
            : `${beneficiaries.length} beneficiários identificados.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {guides.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guia</TableHead>
                <TableHead>Beneficiário</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Procedimentos</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guides.map((guide, index) => (
                <TableRow key={`${guide.numeroGuiaPrestador ?? index}-${index}`}>
                  <TableCell className="font-mono text-xs">
                    {guide.numeroGuiaPrestador ?? guide.numeroGuiaOperadora ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">{guide.beneficiario ?? "—"}</TableCell>
                  <TableCell>{formatDate(guide.dataAtendimento) ?? "—"}</TableCell>
                  <TableCell>{guide.procedureCount}</TableCell>
                  <TableCell className="text-right">{formatCurrency(guide.valorTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-wrap gap-2">
            {beneficiaries.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRecoveryPanel({
  jobId,
  pending,
  onResolved,
}: {
  jobId: string;
  pending: PendingStepRecovery;
  onResolved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [manualSelector, setManualSelector] = useState("");

  function resolve(body: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/jobs/${jobId}/resume-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "Não foi possível resolver a etapa.");
        return;
      }
      onResolved();
    });
  }

  return (
    <Card className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4" /> Etapa aguardando decisão
        </CardTitle>
        <CardDescription>
          O agente exauriu retentativas determinísticas e de visão computacional. Escolha como prosseguir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <ReadOnlyField label="Etapa" value={pending.stepName} />
          <ReadOnlyField label="Tentativas" value={String(pending.attemptsUsed)} />
          <div className="md:col-span-2">
            <Label className="mb-1 block text-xs uppercase tracking-wide">Objetivo</Label>
            <p className="rounded border bg-background p-2 text-xs leading-relaxed">{pending.goal}</p>
          </div>
          <div className="md:col-span-2">
            <Label className="mb-1 block text-xs uppercase tracking-wide">Último erro</Label>
            <p className="rounded border bg-background p-2 font-mono text-xs leading-relaxed">{pending.lastError}</p>
          </div>
        </div>

        {pending.visionSummaries.length > 0 ? (
          <div>
            <Label className="mb-1 block text-xs uppercase tracking-wide">Tentativas anteriores</Label>
            <ol className="space-y-1 rounded border bg-background p-2 text-xs">
              {pending.visionSummaries.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.approach}</span>{" "}
                  <span className="text-muted-foreground">— {s.outcome}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide">Seletor manual (opcional)</Label>
          <Input
            placeholder='ex.: button#botaoAssinarEnviar.orange'
            value={manualSelector}
            onChange={(e) => setManualSelector(e.target.value)}
            disabled={isPending}
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => resolve({ resolution: "retry" })}
            disabled={isPending}
            variant="default"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Tentar novamente
          </Button>
          <Button
            onClick={() =>
              resolve({ resolution: "manual_selector", selector: manualSelector })
            }
            disabled={isPending || manualSelector.trim().length === 0}
            variant="secondary"
          >
            Usar seletor manual
          </Button>
          <Button onClick={() => resolve({ resolution: "skip" })} disabled={isPending} variant="outline">
            Pular etapa
          </Button>
          <Button onClick={() => resolve({ resolution: "fail" })} disabled={isPending} variant="destructive">
            Marcar como falha
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentTimeline({ events }: { events: AgentEvent[] }) {
  return (
    <Collapsible defaultOpen={false}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="group flex cursor-pointer flex-row items-start justify-between gap-2 select-none">
            <div className="space-y-1">
              <CardTitle>Eventos do agente</CardTitle>
              <CardDescription>
                {events.length === 0
                  ? "Sem eventos por enquanto."
                  : `Linha do tempo (${events.length} ${events.length === 1 ? "evento" : "eventos"}).`}
              </CardDescription>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem eventos por enquanto.</p>
            ) : (
              <ol className="space-y-3 border-l border-muted pl-5">
                {events.map((event) => {
                  const tool = typeof event.payload?.toolName === "string" ? event.payload.toolName : null;
                  const status = typeof event.payload?.status === "string" ? event.payload.status : null;
                  return (
                    <li key={event.id} className="relative">
                      <span
                        className={
                          "absolute -left-[27px] top-[7px] size-2.5 rounded-full border-2 border-background " +
                          dotColor(status)
                        }
                      />
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                        {tool ? (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            <Wrench className="size-3" />
                            {tool}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap">{event.message}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value ?? "—"} readOnly />
    </div>
  );
}

function dotColor(status: string | null) {
  switch (status) {
    case "success":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "awaiting_human":
      return "bg-amber-500";
    case "running":
      return "bg-primary";
    default:
      return "bg-muted-foreground";
  }
}

function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  // ISO date or yyyy-mm-dd → display as dd/mm/yyyy.
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  return value;
}

function formatCurrency(value: string | null | undefined) {
  if (!value) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
