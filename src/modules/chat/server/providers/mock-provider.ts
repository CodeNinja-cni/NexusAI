import "server-only";

import type {
  AiProvider,
  ProviderCompletion,
  ProviderStreamRequest,
  ProviderTextStream
} from "../provider";

const MOCK_PREFIX =
  "**Development mock — no external AI provider was called.**\n\n" +
  "This deterministic response exists to test streaming, persistence, Markdown, and recovery states.\n\n";

export class MockAiProvider implements AiProvider {
  readonly id = "mock" as const;
  readonly model = "nexus-deterministic-v1";

  constructor(private readonly chunkDelayMs: number) {}

  stream(request: ProviderStreamRequest): ProviderTextStream {
    const prompt = request.messages.at(-1)?.content.trim() || "an empty prompt";
    const boundedPrompt = prompt.slice(0, 400);
    const response = `${MOCK_PREFIX}### Prompt received\n\n> ${boundedPrompt.replaceAll("\n", "\n> ")}\n\n\`\`\`text\nmock-stream-complete\n\`\`\``;
    const chunks = response.match(/.{1,18}/gsu) ?? [response];
    let resolveCompletion!: (value: ProviderCompletion) => void;
    let rejectCompletion!: (reason: unknown) => void;
    const completion = new Promise<ProviderCompletion>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const textStream = this.generate(chunks, request, resolveCompletion, rejectCompletion);
    return { textStream, completion };
  }

  private async *generate(
    chunks: readonly string[],
    request: ProviderStreamRequest,
    resolve: (value: ProviderCompletion) => void,
    reject: (reason: unknown) => void
  ): AsyncGenerator<string> {
    try {
      for (const chunk of chunks) {
        if (request.signal.aborted)
          throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
        if (this.chunkDelayMs > 0) await abortableDelay(this.chunkDelayMs, request.signal);
        yield chunk;
      }

      resolve({
        finishReason: "stop",
        usage: {
          inputTokens: estimateMockTokens(
            request.messages.map((message) => message.content).join(" ")
          ),
          outputTokens: estimateMockTokens(chunks.join(""))
        },
        providerRequestId: `mock-${crypto.randomUUID()}`
      });
    } catch (error) {
      reject(error);
      throw error;
    }
  }
}

function estimateMockTokens(value: string) {
  return value.length === 0 ? 0 : Math.max(1, Math.ceil([...value].length / 4));
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
