import "server-only";

const activeGenerations = new Map<string, AbortController>();

export function registerGeneration(messageId: string, controller: AbortController) {
  activeGenerations.set(messageId, controller);
  return () => {
    if (activeGenerations.get(messageId) === controller) activeGenerations.delete(messageId);
  };
}

export function signalGenerationCancellation(messageId: string) {
  activeGenerations.get(messageId)?.abort(new DOMException("Generation cancelled", "AbortError"));
}
