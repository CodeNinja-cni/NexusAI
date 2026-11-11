import "server-only";

import { randomUUID } from "node:crypto";

import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { calculateEstimatedCostMicros } from "@/modules/usage/server/pricing";
import { settleAiUsage } from "@/modules/usage/server/quota";

import type { GenerationAttempt } from "./chat-service";
import { registerGeneration } from "./generation-registry";
import { createAiProvider, resolveChatModel } from "./model-catalog";
import type { ProviderCompletion, ProviderUsage } from "./provider";

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15_000;
const CANCELLATION_POLL_MS = 400;
const CHECKPOINT_MS = 700;
const CHECKPOINT_CHARS = 768;

export function createGenerationResponse(
  attempt: GenerationAttempt,
  requestSignal: AbortSignal,
  requestId: string
) {
  const model = resolveChatModel(attempt.modelKey);
  const provider = createAiProvider(model);
  const abortController = new AbortController();
  const unregister = registerGeneration(attempt.assistantMessageId, abortController);
  let clientDisconnected = requestSignal.aborted;
  let timedOut = false;
  let streamClosed = false;

  const disconnect = () => {
    clientDisconnected = true;
    abortController.abort(new DOMException("Client disconnected", "AbortError"));
  };
  requestSignal.addEventListener("abort", disconnect, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let eventId = 0;
      let content = "";
      let lastCheckpointLength = 0;
      let lastCheckpointAt = Date.now();
      let providerCompletion: ProviderCompletion | undefined;
      const startedAt = Date.now();
      const emit = (event: string, data: Record<string, unknown>) => {
        if (streamClosed || clientDisconnected) return;
        try {
          eventId += 1;
          controller.enqueue(
            encoder.encode(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          disconnect();
        }
      };
      const heartbeat = setInterval(() => emit("heartbeat", { requestId }), HEARTBEAT_MS);
      const timeout = setTimeout(() => {
        timedOut = true;
        abortController.abort(new DOMException("Generation timed out", "TimeoutError"));
      }, getServerEnvironment().ai.requestTimeoutMs);
      const cancellationPoll = setInterval(() => {
        void pollForCancellation(attempt.assistantMessageId, abortController);
      }, CANCELLATION_POLL_MS);

      try {
        const started = await prisma.message.updateMany({
          where: { id: attempt.assistantMessageId, status: "PENDING" },
          data: {
            status: "STREAMING",
            provider: provider.id,
            model: provider.model,
            startedAt: new Date()
          }
        });
        if (started.count !== 1) throw new Error("generation_state_conflict");

        emit("generation.started", {
          conversationId: attempt.conversationId,
          userMessageId: attempt.userMessageId,
          assistantMessageId: attempt.assistantMessageId,
          model: attempt.modelKey,
          requestId,
          citations: attempt.citations ?? []
        });

        const providerStream = provider.stream({
          messages: attempt.prompt,
          signal: abortController.signal
        });
        void providerStream.completion.catch(() => undefined);

        for await (const delta of providerStream.textStream) {
          if (abortController.signal.aborted) break;
          if (!delta) continue;
          content += delta;
          emit("message.delta", {
            assistantMessageId: attempt.assistantMessageId,
            delta,
            requestId
          });

          const checkpointDue =
            content.length - lastCheckpointLength >= CHECKPOINT_CHARS ||
            Date.now() - lastCheckpointAt >= CHECKPOINT_MS;
          if (checkpointDue) {
            await checkpointMessage(attempt.assistantMessageId, content);
            lastCheckpointLength = content.length;
            lastCheckpointAt = Date.now();
          }
        }

        if (abortController.signal.aborted) throw abortController.signal.reason;
        providerCompletion = await providerStream.completion;
        const finalized = await finalizeSuccess({
          attempt,
          requestId,
          provider: provider.id,
          providerModel: provider.model,
          content,
          completion: providerCompletion,
          latencyMs: Date.now() - startedAt
        });

        if (finalized === "cancelled") {
          emit("generation.cancelled", {
            assistantMessageId: attempt.assistantMessageId,
            status: "CANCELLED",
            partialContentRetained: content.length > 0,
            requestId
          });
        } else {
          emit("generation.completed", {
            assistantMessageId: attempt.assistantMessageId,
            status: "COMPLETED",
            finishReason: providerCompletion.finishReason,
            ...(providerCompletion.usage
              ? { usage: serializeUsage(providerCompletion.usage) }
              : {}),
            requestId
          });
        }
      } catch (error) {
        const cancelled = await cancellationWasRequested(attempt.assistantMessageId);
        const outcome = timedOut
          ? "timeout"
          : cancelled || clientDisconnected
            ? "cancelled"
            : "failed";
        await finalizeFailure({
          attempt,
          requestId,
          provider: provider.id,
          providerModel: provider.model,
          content,
          providerCompletion,
          latencyMs: Date.now() - startedAt,
          outcome
        });

        if (outcome === "cancelled") {
          emit("generation.cancelled", {
            assistantMessageId: attempt.assistantMessageId,
            status: "CANCELLED",
            partialContentRetained: content.length > 0,
            requestId
          });
        } else {
          emit("generation.error", {
            assistantMessageId: attempt.assistantMessageId,
            code: outcome === "timeout" ? "generation_timeout" : "provider_unavailable",
            message:
              outcome === "timeout"
                ? "The response exceeded the configured time limit."
                : "The AI provider could not complete this response.",
            retryable: true,
            requestId
          });
        }

        if (getServerEnvironment().logLevel === "debug" && !clientDisconnected) {
          console.error("Chat generation failed", {
            requestId,
            assistantMessageId: attempt.assistantMessageId,
            errorName: error instanceof Error ? error.name : "UnknownError"
          });
        }
      } finally {
        clearInterval(heartbeat);
        clearInterval(cancellationPoll);
        clearTimeout(timeout);
        unregister();
        requestSignal.removeEventListener("abort", disconnect);
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      }
    },
    cancel() {
      disconnect();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId
    }
  });
}

async function checkpointMessage(messageId: string, content: string) {
  await prisma.message.updateMany({
    where: { id: messageId, status: { in: ["STREAMING", "CANCEL_REQUESTED"] } },
    data: { content }
  });
}

async function pollForCancellation(messageId: string, controller: AbortController) {
  if (controller.signal.aborted) return;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { status: true }
  });
  if (message?.status === "CANCEL_REQUESTED") {
    controller.abort(new DOMException("Generation cancelled", "AbortError"));
  }
}

async function cancellationWasRequested(messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { status: true }
  });
  return message?.status === "CANCEL_REQUESTED";
}

async function finalizeSuccess(input: {
  readonly attempt: GenerationAttempt;
  readonly requestId: string;
  readonly provider: string;
  readonly providerModel: string;
  readonly content: string;
  readonly completion: ProviderCompletion;
  readonly latencyMs: number;
}) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.message.findUnique({
      where: { id: input.attempt.assistantMessageId },
      select: { status: true }
    });
    if (current?.status === "CANCEL_REQUESTED") {
      await transaction.message.update({
        where: { id: input.attempt.assistantMessageId },
        data: { status: "CANCELLED", content: input.content, completedAt: new Date() }
      });
      await createUsageRecord(transaction, {
        ...input,
        status: "CANCELLED",
        usage: input.completion.usage,
        providerRequestId: input.completion.providerRequestId
      });
      return "cancelled" as const;
    }
    if (!current || current.status !== "STREAMING") throw new Error("generation_state_conflict");

    await transaction.message.update({
      where: { id: input.attempt.assistantMessageId },
      data: {
        status: "COMPLETED",
        content: input.content,
        provider: input.provider,
        model: input.providerModel,
        finishReason: input.completion.finishReason,
        completedAt: new Date()
      }
    });
    await transaction.conversation.update({
      where: { id: input.attempt.conversationId },
      data: {
        activeLeafMessageId: input.attempt.assistantMessageId,
        lastMessageAt: new Date(),
        version: { increment: 1 }
      }
    });
    await createUsageRecord(transaction, {
      ...input,
      status: "SUCCEEDED",
      usage: input.completion.usage,
      providerRequestId: input.completion.providerRequestId
    });
    return "completed" as const;
  });
}

async function finalizeFailure(input: {
  readonly attempt: GenerationAttempt;
  readonly requestId: string;
  readonly provider: string;
  readonly providerModel: string;
  readonly content: string;
  readonly providerCompletion?: ProviderCompletion | undefined;
  readonly latencyMs: number;
  readonly outcome: "failed" | "cancelled" | "timeout";
}) {
  const messageStatus = input.outcome === "cancelled" ? "CANCELLED" : "FAILED";
  const usageStatus =
    input.outcome === "cancelled"
      ? "CANCELLED"
      : input.outcome === "timeout"
        ? "TIMED_OUT"
        : "FAILED";
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.message.updateMany({
      where: {
        id: input.attempt.assistantMessageId,
        status: { in: ["PENDING", "STREAMING", "CANCEL_REQUESTED"] }
      },
      data: {
        status: messageStatus,
        content: input.content,
        provider: input.provider,
        model: input.providerModel,
        errorCode:
          input.outcome === "cancelled"
            ? "generation_cancelled"
            : input.outcome === "timeout"
              ? "generation_timeout"
              : "provider_unavailable",
        completedAt: new Date()
      }
    });
    if (updated.count === 0) return;
    await createUsageRecord(transaction, {
      ...input,
      status: usageStatus,
      usage: input.providerCompletion?.usage,
      providerRequestId: input.providerCompletion?.providerRequestId
    });
  });
}

async function createUsageRecord(
  transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    readonly attempt: GenerationAttempt;
    readonly requestId: string;
    readonly provider: string;
    readonly providerModel: string;
    readonly latencyMs: number;
    readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
    readonly usage?: ProviderUsage | undefined;
    readonly providerRequestId?: string | undefined;
  }
) {
  const reservation = await transaction.usageReservation.findUnique({
    where: { logicalOperationId: input.attempt.assistantMessageId },
    select: {
      modelPrice: {
        select: {
          id: true,
          version: true,
          currency: true,
          inputPriceMicrosPerMillion: true,
          cachedInputPriceMicrosPerMillion: true,
          outputPriceMicrosPerMillion: true
        }
      }
    }
  });
  const price = reservation?.modelPrice ?? null;
  const estimatedCostMicros =
    input.usage && price
      ? calculateEstimatedCostMicros(
          {
            inputTokens: BigInt(input.usage.inputTokens),
            outputTokens: BigInt(input.usage.outputTokens),
            cachedInputTokens:
              input.usage.cachedInputTokens === undefined
                ? null
                : BigInt(input.usage.cachedInputTokens),
            reasoningTokens:
              input.usage.reasoningTokens === undefined ? null : BigInt(input.usage.reasoningTokens)
          },
          price
        )
      : 0n;
  await transaction.usageRecord.create({
    data: {
      operationId: randomUUID(),
      logicalOperationId: input.attempt.assistantMessageId,
      workspaceId: input.attempt.workspaceId,
      userId: input.attempt.userId,
      conversationId: input.attempt.conversationId,
      messageId: input.attempt.assistantMessageId,
      requestId: input.requestId,
      providerRequestId: input.providerRequestId ?? null,
      operation: "chat.completion",
      provider: input.provider,
      model: input.providerModel,
      status: input.status,
      usageSource: input.usage
        ? input.provider === "mock"
          ? "DEVELOPMENT_ESTIMATE"
          : "PROVIDER_REPORTED"
        : "UNAVAILABLE",
      inputTokens: BigInt(input.usage?.inputTokens ?? 0),
      outputTokens: BigInt(input.usage?.outputTokens ?? 0),
      cachedInputTokens:
        input.usage?.cachedInputTokens === undefined ? null : BigInt(input.usage.cachedInputTokens),
      reasoningTokens:
        input.usage?.reasoningTokens === undefined ? null : BigInt(input.usage.reasoningTokens),
      estimatedCostMicros,
      currency: price?.currency ?? "USD",
      pricingVersion: price?.version ?? `${input.provider}-unpriced-v1`,
      pricingStatus: price && input.usage ? "PRICED" : "UNPRICED",
      modelPriceId: price && input.usage ? price.id : null,
      inputPriceMicrosPerMillion: price && input.usage ? price.inputPriceMicrosPerMillion : null,
      cachedInputPriceMicrosPerMillion:
        price && input.usage ? price.cachedInputPriceMicrosPerMillion : null,
      outputPriceMicrosPerMillion: price && input.usage ? price.outputPriceMicrosPerMillion : null,
      latencyMs: input.latencyMs,
      metadata: {
        costEstimated: Boolean(price && input.usage),
        usageSource: input.usage
          ? input.provider === "mock"
            ? "deterministic_mock_estimate"
            : "provider_reported"
          : "provider_usage_unavailable"
      }
    }
  });
  await settleAiUsage(transaction, {
    logicalOperationId: input.attempt.assistantMessageId,
    usage: input.usage,
    estimatedCostMicros
  });
}

function serializeUsage(usage: ProviderUsage) {
  return {
    inputTokens: String(usage.inputTokens),
    outputTokens: String(usage.outputTokens),
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: String(usage.cachedInputTokens) }),
    ...(usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: String(usage.reasoningTokens) })
  };
}
