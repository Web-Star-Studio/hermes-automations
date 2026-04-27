"use client";

import { memo, useMemo } from "react";
import type { Edge as FlowEdge, Node as FlowNode, NodeProps } from "@xyflow/react";
import { CheckCircle2, Circle, CircleAlert, Clock3, Loader2 } from "lucide-react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Controls } from "@/components/ai-elements/controls";
import { Edge } from "@/components/ai-elements/edge";
import {
  Node,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobWorkflowEdge, JobWorkflowNode, WorkflowNodeStatus } from "@/lib/jobs/workflow-visualization";

type JobWorkflowCanvasProps = {
  nodes: JobWorkflowNode[];
  edges: JobWorkflowEdge[];
  activeNodeId: string;
};

const nodeTypes = {
  jobNode: memo(JobFlowNode),
};

const edgeTypes = {
  animated: Edge.Animated,
};

export function JobWorkflowCanvas({ nodes, edges, activeNodeId }: JobWorkflowCanvasProps) {
  const flowNodes = useMemo<Array<FlowNode<JobWorkflowNode>>>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "jobNode",
        position: node.position,
        data: node,
      })),
    [nodes],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const target = nodes.find((node) => node.id === edge.target);
        const active = edge.source === activeNodeId || edge.target === activeNodeId;

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: active && target?.status !== "pending" ? "animated" : "default",
          animated: active,
          className: target?.status === "failed" ? "stroke-destructive" : undefined,
        };
      }),
    [activeNodeId, edges, nodes],
  );

  return (
    <div className="h-[520px] overflow-hidden rounded-md border bg-sidebar">
      <Canvas
        edgeTypes={edgeTypes}
        edges={flowEdges}
        maxZoom={1.4}
        minZoom={0.45}
        nodes={flowNodes}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
      >
        <Controls showInteractive={false} />
      </Canvas>
    </div>
  );
}

function JobFlowNode({ data }: NodeProps<FlowNode<JobWorkflowNode>>) {
  const tone = statusTone[data.status];
  const Icon = statusIcon[data.status];

  return (
    <Node
      className={cn(
        "w-[220px] shadow-none",
        data.status === "running" && "border-primary",
        data.status === "awaiting_human" && "border-amber-500",
        data.status === "failed" && "border-destructive",
      )}
      handles={{
        source: data.id !== "complete" && data.id !== "error",
        target: data.id !== "upload",
      }}
    >
      <NodeHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <NodeTitle className="truncate text-sm">{data.title}</NodeTitle>
            <NodeDescription className="truncate text-xs">{data.description}</NodeDescription>
          </div>
          <Icon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              data.status === "running" && "animate-spin",
              tone.icon,
            )}
          />
        </div>
      </NodeHeader>
      <NodeContent>
        <Badge className={cn("text-[11px]", tone.badge)} variant="outline">
          {statusLabel[data.status]}
        </Badge>
      </NodeContent>
    </Node>
  );
}

const statusLabel: Record<WorkflowNodeStatus, string> = {
  pending: "pendente",
  running: "em execução",
  awaiting_human: "aguardando humano",
  success: "concluído",
  failed: "falhou",
};

const statusIcon = {
  pending: Circle,
  running: Loader2,
  awaiting_human: Clock3,
  success: CheckCircle2,
  failed: CircleAlert,
} satisfies Record<WorkflowNodeStatus, typeof Circle>;

const statusTone: Record<WorkflowNodeStatus, { icon: string; badge: string }> = {
  pending: { icon: "text-muted-foreground", badge: "text-muted-foreground" },
  running: { icon: "text-primary", badge: "border-primary text-primary" },
  awaiting_human: { icon: "text-amber-600", badge: "border-amber-500 text-amber-700" },
  success: { icon: "text-emerald-600", badge: "border-emerald-500 text-emerald-700" },
  failed: { icon: "text-destructive", badge: "border-destructive text-destructive" },
};
