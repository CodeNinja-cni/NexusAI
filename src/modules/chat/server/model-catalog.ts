import "server-only";

import { getServerEnvironment } from "@/platform/env/server";

import { MockAiProvider } from "./providers/mock-provider";
import { OpenAiProvider } from "./providers/openai-provider";
import type { AiProvider } from "./provider";

export interface ChatModel {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly provider: "openai" | "mock";
  readonly developmentOnly: boolean;
}

const OPENAI_MODEL: ChatModel = {
  key: "openai/nexus-core",
  label: "NEXUS Core",
  description: "OpenAI-backed general reasoning and writing.",
  provider: "openai",
  developmentOnly: false
};

const MOCK_MODEL: ChatModel = {
  key: "mock/nexus-dev",
  label: "NEXUS Dev Mock",
  description: "Deterministic local stream for interface and integration testing.",
  provider: "mock",
  developmentOnly: true
};

export function listEnabledChatModels(): readonly ChatModel[] {
  return getServerEnvironment().ai.provider === "openai" ? [OPENAI_MODEL] : [MOCK_MODEL];
}

export function resolveChatModel(modelKey?: string | null): ChatModel {
  const models = listEnabledChatModels();
  const model = modelKey ? models.find((candidate) => candidate.key === modelKey) : models[0];

  if (!model) {
    throw new UnsupportedChatModelError();
  }

  return model;
}

export function createAiProvider(model: ChatModel): AiProvider {
  const environment = getServerEnvironment();

  if (model.provider === "mock") {
    return new MockAiProvider(environment.ai.mockChunkDelayMs);
  }

  if (!environment.ai.openAiApiKey) {
    throw new ProviderConfigurationError();
  }

  return new OpenAiProvider({
    apiKey: environment.ai.openAiApiKey,
    model: environment.ai.openAiModel,
    maxOutputTokens: environment.ai.maxOutputTokens,
    timeoutMs: environment.ai.requestTimeoutMs
  });
}

export function assertChatProviderAvailable(modelKey: string) {
  createAiProvider(resolveChatModel(modelKey));
}

export class UnsupportedChatModelError extends Error {}
export class ProviderConfigurationError extends Error {}
