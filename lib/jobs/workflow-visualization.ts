import type { JobStatus } from "@/lib/db/schema";

export type WorkflowNodeStatus = "pending" | "running" | "awaiting_human" | "success" | "failed";

export type JobWorkflowNode = {
  id: string;
  title: string;
  description: string;
  status: WorkflowNodeStatus;
  position: { x: number; y: number };
};

export type JobWorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

export type AgentEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: Date | string;
  payload: Record<string, unknown>;
};

type JobLike = {
  status: JobStatus;
  errorMessage?: string | null;
};

const baseNodes: JobWorkflowNode[] = [
  {
    id: "upload",
    title: "Recebimento",
    description: "Arquivo TISS recebido",
    status: "pending",
    position: { x: 0, y: 120 },
  },
  {
    id: "tiss_extraction",
    title: "Extração TISS",
    description: "Parser determinístico do XML",
    status: "pending",
    position: { x: 260, y: 120 },
  },
  {
    id: "agent_review",
    title: "Análise do agente",
    description: "Resumo operacional",
    status: "pending",
    position: { x: 520, y: 120 },
  },
  {
    id: "human_validation",
    title: "Validação humana",
    description: "Aprovação obrigatória",
    status: "pending",
    position: { x: 780, y: 120 },
  },
  {
    id: "browserbase_session",
    title: "Sessão de browser",
    description: "Browserbase preparada",
    status: "pending",
    position: { x: 1040, y: 40 },
  },
  {
    id: "orizon_login",
    title: "Login Orizon",
    description: "Credencial segura",
    status: "pending",
    position: { x: 1300, y: 40 },
  },
  {
    id: "submit_tiss",
    title: "Envio TISS",
    description: "Upload e confirmação do lote",
    status: "pending",
    position: { x: 1560, y: 40 },
  },
  {
    id: "complete",
    title: "Concluído",
    description: "Lote enviado com sucesso",
    status: "pending",
    position: { x: 1820, y: 40 },
  },
  {
    id: "error",
    title: "Atenção necessária",
    description: "Falha recuperável",
    status: "pending",
    position: { x: 1820, y: 210 },
  },
];

const baseEdges: JobWorkflowEdge[] = [
  { id: "upload-tiss", source: "upload", target: "tiss_extraction" },
  { id: "tiss-agent", source: "tiss_extraction", target: "agent_review" },
  { id: "agent-human", source: "agent_review", target: "human_validation" },
  { id: "human-browser", source: "human_validation", target: "browserbase_session" },
  { id: "browser-login", source: "browserbase_session", target: "orizon_login" },
  { id: "login-submit", source: "orizon_login", target: "submit_tiss" },
  { id: "submit-complete", source: "submit_tiss", target: "complete" },
  { id: "login-error", source: "orizon_login", target: "error" },
  { id: "submit-error", source: "submit_tiss", target: "error" },
];

export function buildJobWorkflowState(job: JobLike, events: AgentEvent[]) {
  const statuses = new Map<string, WorkflowNodeStatus>();

  for (const node of baseNodes) {
    statuses.set(node.id, "pending");
  }

  statuses.set("upload", "success");

  for (const event of events) {
    const nodeId = typeof event.payload?.nodeId === "string" ? event.payload.nodeId : nodeForEvent(event.type);
    const status = statusForEvent(event.type, event.payload?.status);

    if (nodeId && status) {
      statuses.set(nodeId, mergeStatus(statuses.get(nodeId) ?? "pending", status));
    }
  }

  const passedHumanValidation = events.some((event) => event.type === "validation_approved");
  const reachedHumanGate =
    job.status === "awaiting_validation" ||
    job.status === "approved" ||
    job.status === "running" ||
    job.status === "login_succeeded" ||
    passedHumanValidation;

  if (reachedHumanGate) {
    statuses.set("tiss_extraction", "success");
    statuses.set("agent_review", "success");
  }

  if (job.status === "awaiting_validation") {
    statuses.set("human_validation", "awaiting_human");
  }

  if (job.status === "approved" || job.status === "running" || passedHumanValidation) {
    statuses.set("human_validation", "success");
    if (statuses.get("browserbase_session") === "pending") {
      statuses.set("browserbase_session", "running");
    }
  }

  if (job.status === "login_succeeded") {
    statuses.set("browserbase_session", "success");
    statuses.set("orizon_login", "success");
    if (events.some((event) => event.type === "submit_tiss_completed")) {
      statuses.set("submit_tiss", "success");
      statuses.set("complete", "success");
    } else if (statuses.get("submit_tiss") === "pending") {
      statuses.set("submit_tiss", "running");
    }
  }

  if (job.status === "failed") {
    statuses.set("error", "failed");
    // The run has stopped — no node is actually executing anymore.
    // `complete` is the happy-path terminal; revert it so it doesn't read as in-progress.
    // Anything else still painted as `running` reflects a tool that crashed before it
    // could emit its own failure event — show it as `failed`.
    for (const [id, current] of statuses) {
      if (current === "running") {
        statuses.set(id, id === "complete" ? "pending" : "failed");
      }
    }
  }

  const nodes = baseNodes.map((node) => ({
    ...node,
    status: statuses.get(node.id) ?? "pending",
  }));

  const activeNodeId =
    nodes.find((node) => node.status === "failed")?.id ??
    nodes.find((node) => node.status === "awaiting_human")?.id ??
    [...nodes].reverse().find((node) => node.status === "running")?.id ??
    [...nodes].reverse().find((node) => node.status === "success")?.id ??
    "upload";

  return {
    nodes,
    edges: baseEdges,
    activeNodeId,
    agentEvents: events.filter(
      (event) =>
        event.type.startsWith("agent_") ||
        event.type.includes("browser") ||
        event.type.includes("human") ||
        event.type.startsWith("submit_tiss"),
    ),
  };
}

function statusForEvent(type: string, payloadStatus: unknown): WorkflowNodeStatus | null {
  if (payloadStatus === "awaiting_human") return "awaiting_human";
  if (payloadStatus === "running") return "running";
  if (payloadStatus === "success") return "success";
  if (payloadStatus === "failed") return "failed";

  if (type === "uploaded") return "success";
  if (type === "agent_started" || type === "agent_step_started") return "running";
  if (type === "agent_tool_completed") return "success";
  if (type === "human_validation_requested" || type === "awaiting_validation") return "awaiting_human";
  if (type === "validation_approved") return "success";
  if (type === "browser_session_started") return "running";
  if (type === "browser_action_completed" || type === "login_succeeded") return "success";
  if (type === "login_failed" || type === "failed") return "failed";
  if (type === "agent_completed") return "success";
  if (type === "submit_tiss_progress") return "running";
  if (type === "submit_tiss_completed") return "success";
  if (type === "submit_tiss_failed") return "failed";

  return null;
}

function nodeForEvent(type: string) {
  if (type === "uploaded") return "upload";
  if (type === "parsing_started" || type === "parsing_completed") return "tiss_extraction";
  if (type === "agent_started" || type === "agent_step_started") return "agent_review";
  if (type === "human_validation_requested" || type === "awaiting_validation" || type === "validation_approved") {
    return "human_validation";
  }
  if (type === "browser_session_started") return "browserbase_session";
  if (type === "browser_action_completed" || type === "login_started" || type === "login_succeeded") {
    return "orizon_login";
  }
  if (
    type === "submit_tiss_progress" ||
    type === "submit_tiss_completed" ||
    type === "submit_tiss_failed"
  ) {
    return "submit_tiss";
  }
  if (type === "login_failed" || type === "failed") return "error";
  if (type === "agent_completed") return "complete";
  return null;
}

function mergeStatus(current: WorkflowNodeStatus, next: WorkflowNodeStatus): WorkflowNodeStatus {
  const rank: Record<WorkflowNodeStatus, number> = {
    pending: 0,
    running: 1,
    awaiting_human: 2,
    success: 3,
    failed: 4,
  };

  return rank[next] >= rank[current] ? next : current;
}
