import { gateway, type GatewayModelId } from "ai";

const defaultModel = "openai/gpt-5.4" satisfies GatewayModelId;
const fallbackModel = "anthropic/claude-sonnet-4.6" satisfies GatewayModelId;

export function getGatewayModel(modelId?: string) {
  return gateway((modelId ?? process.env.AI_GATEWAY_MODEL ?? defaultModel) as GatewayModelId);
}

export function getGatewayModelId(modelId?: string) {
  return (modelId ?? process.env.AI_GATEWAY_MODEL ?? defaultModel) as GatewayModelId;
}

export function getGatewayProviderOptions(input: {
  userId: string;
  feature: "job-assistant" | "tiss-extraction" | "browser-agent";
  tags?: string[];
}) {
  return {
    gateway: {
      user: input.userId,
      models: [process.env.AI_GATEWAY_FALLBACK_MODEL ?? fallbackModel],
      tags: [
        `feature:${input.feature}`,
        `env:${process.env.VERCEL_ENV ?? "local"}`,
        ...input.tags ?? [],
      ],
    },
  };
}

export async function getAvailableGatewayModelIds() {
  const { models } = await gateway.getAvailableModels();
  return models.map((model) => model.id);
}
