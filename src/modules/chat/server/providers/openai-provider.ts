import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import type { AiProvider, ProviderStreamRequest, ProviderTextStream } from "../provider";

interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly options: OpenAiProviderOptions;

  constructor(options: OpenAiProviderOptions) {
    this.options = options;
    this.model = options.model;
  }

  stream(request: ProviderStreamRequest): ProviderTextStream {
    const openai = createOpenAI({ apiKey: this.options.apiKey });
    const result = streamText({
      model: openai(this.options.model),
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      abortSignal: request.signal,
      timeout: {
        totalMs: this.options.timeoutMs,
        chunkMs: Math.min(20_000, this.options.timeoutMs)
      },
      maxOutputTokens: this.options.maxOutputTokens,
      maxRetries: 2,
      providerOptions: { openai: { store: false } }
    });

    return {
      textStream: result.textStream,
      completion: Promise.all([result.finishReason, result.usage, result.response]).then(
        ([finishReason, usage, response]) => {
          const inputTokens = validTokenCount(usage.inputTokens);
          const outputTokens = validTokenCount(usage.outputTokens);
          const cachedInputTokens = validTokenCount(usage.inputTokenDetails.cacheReadTokens);
          const reasoningTokens = validTokenCount(usage.outputTokenDetails.reasoningTokens);
          return {
            finishReason,
            ...(inputTokens === undefined || outputTokens === undefined
              ? {}
              : {
                  usage: {
                    inputTokens,
                    outputTokens,
                    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
                    ...(reasoningTokens === undefined ? {} : { reasoningTokens })
                  }
                }),
            ...(response.id ? { providerRequestId: response.id } : {})
          };
        }
      )
    };
  }
}

function validTokenCount(value: number | undefined) {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
