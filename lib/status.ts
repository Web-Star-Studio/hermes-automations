import type { JobFlowType, JobStatus } from "@/lib/db/schema";

export const jobStatusLabels: Record<JobStatus, string> = {
  uploaded: "Recebido",
  awaiting_validation: "Aguardando validacao",
  approved: "Aprovado",
  running: "Executando",
  login_succeeded: "Lote enviado",
  failed: "Falhou",
};

export const jobStatusTone: Record<JobStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    uploaded: "secondary",
    awaiting_validation: "outline",
    approved: "secondary",
    running: "default",
    login_succeeded: "default",
    failed: "destructive",
  };

export const jobFlowLabels: Record<JobFlowType, string> = {
  short: "Fluxo curto",
  complete: "Fluxo completo",
};
