import "server-only";

export interface ProviderPromptMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export interface ProviderCompletion {
  readonly finishReason: string;
  readonly usage?: ProviderUsage;
  readonly providerRequestId?: string;
}

export interface ProviderTextStream {
  readonly textStream: AsyncIterable<string>;
  readonly completion: Promise<ProviderCompletion>;
}

export interface ProviderStreamRequest {
  readonly messages: readonly ProviderPromptMessage[];
  readonly signal: AbortSignal;
}

export interface AiProvider {
  readonly id: "openai" | "mock";
  readonly model: string;
  stream(request: ProviderStreamRequest): ProviderTextStream;
}
