import { createHash } from "node:crypto";

import { z } from "zod";

export const WORKFLOW_SCHEMA_VERSION = "nexus.workflow.v1";
export const WORKFLOW_NODE_KINDS = ["INPUT", "TEMPLATE", "AI_PROMPT", "OUTPUT"] as const;

const nodeIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u, "Use letters, numbers, underscores, or hyphens.");
const positionSchema = z
  .object({
    x: z.number().finite().min(-10_000).max(10_000),
    y: z.number().finite().min(-10_000).max(10_000)
  })
  .strict();

const nodeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: nodeIdSchema,
      kind: z.literal("INPUT"),
      position: positionSchema,
      config: z
        .object({ label: z.string().trim().min(1).max(80).default("Workflow input") })
        .strict()
    })
    .strict(),
  z
    .object({
      id: nodeIdSchema,
      kind: z.literal("TEMPLATE"),
      position: positionSchema,
      config: z
        .object({
          template: z
            .string()
            .min(1)
            .max(4_000)
            .refine(
              (value) => !value.includes("${") && !value.includes("<%"),
              "Executable template syntax is not supported. Use {{input}} or {{previous}} only."
            )
        })
        .strict()
    })
    .strict(),
  z
    .object({
      id: nodeIdSchema,
      kind: z.literal("AI_PROMPT"),
      position: positionSchema,
      config: z
        .object({
          instruction: z.string().trim().min(1).max(4_000),
          modelKey: z.string().trim().min(1).max(120)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      id: nodeIdSchema,
      kind: z.literal("OUTPUT"),
      position: positionSchema,
      config: z
        .object({ label: z.string().trim().min(1).max(80).default("Workflow output") })
        .strict()
    })
    .strict()
]);

const edgeSchema = z
  .object({
    id: nodeIdSchema,
    source: nodeIdSchema,
    target: nodeIdSchema
  })
  .strict();

const rawDefinitionSchema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema)
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof rawDefinitionSchema>;
export type WorkflowNode = WorkflowDefinition["nodes"][number];
export type WorkflowNodeKind = WorkflowNode["kind"];

export interface WorkflowDefinitionLimits {
  readonly maxNodes: number;
  readonly maxSteps: number;
}

export class WorkflowDefinitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: readonly (string | number)[] = []
  ) {
    super(message);
  }
}

export function parseWorkflowDefinition(value: unknown, limits: WorkflowDefinitionLimits) {
  const parsed = rawDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new WorkflowDefinitionError(
      "workflow_schema_invalid",
      issue?.message ?? "The workflow definition is invalid.",
      issue?.path.filter((item): item is string | number => typeof item !== "symbol") ?? []
    );
  }
  validateGraph(parsed.data, limits);
  return parsed.data;
}

export function workflowDefinitionDigest(definition: WorkflowDefinition) {
  return createHash("sha256").update(stableJson(definition)).digest("hex");
}

export function topologicalNodes(definition: WorkflowDefinition) {
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of definition.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const ready = definition.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  while (ready.length) {
    const id = ready.shift();
    if (!id) break;
    const node = nodeById.get(id);
    if (node) ordered.push(node);
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  return ordered;
}

export function predecessorId(definition: WorkflowDefinition, nodeId: string) {
  return definition.edges.find((edge) => edge.target === nodeId)?.source ?? null;
}

function validateGraph(definition: WorkflowDefinition, limits: WorkflowDefinitionLimits) {
  if (definition.nodes.length < 2 || definition.nodes.length > limits.maxNodes) {
    throw new WorkflowDefinitionError(
      "workflow_node_limit",
      `A workflow must contain between 2 and ${limits.maxNodes} nodes.`,
      ["nodes"]
    );
  }
  if (definition.nodes.length > limits.maxSteps) {
    throw new WorkflowDefinitionError(
      "workflow_step_limit",
      `This workflow exceeds the ${limits.maxSteps}-step execution limit.`,
      ["nodes"]
    );
  }
  if (definition.edges.length > Math.min(200, limits.maxNodes * 4)) {
    throw new WorkflowDefinitionError(
      "workflow_edge_limit",
      "The workflow has too many connections.",
      ["edges"]
    );
  }
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const [index, node] of definition.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      throw new WorkflowDefinitionError("workflow_duplicate_node", "Node IDs must be unique.", [
        "nodes",
        index,
        "id"
      ]);
    }
    nodeIds.add(node.id);
  }
  const inputNodes = definition.nodes.filter((node) => node.kind === "INPUT");
  const outputNodes = definition.nodes.filter((node) => node.kind === "OUTPUT");
  if (inputNodes.length !== 1 || outputNodes.length !== 1) {
    throw new WorkflowDefinitionError(
      "workflow_terminal_nodes",
      "A workflow must contain exactly one input node and one output node.",
      ["nodes"]
    );
  }
  if (definition.nodes.filter((node) => node.kind === "AI_PROMPT").length > 4) {
    throw new WorkflowDefinitionError(
      "workflow_ai_node_limit",
      "At most four AI prompt nodes are allowed.",
      ["nodes"]
    );
  }
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
  const connectionPairs = new Set<string>();
  for (const [index, edge] of definition.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      throw new WorkflowDefinitionError(
        "workflow_duplicate_edge",
        "Connection IDs must be unique.",
        ["edges", index, "id"]
      );
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new WorkflowDefinitionError(
        "workflow_unknown_node",
        "Every connection must reference existing nodes.",
        ["edges", index]
      );
    }
    if (edge.source === edge.target) {
      throw new WorkflowDefinitionError(
        "workflow_self_connection",
        "A node cannot connect to itself.",
        ["edges", index]
      );
    }
    const pair = `${edge.source}\u0000${edge.target}`;
    if (connectionPairs.has(pair)) {
      throw new WorkflowDefinitionError(
        "workflow_duplicate_connection",
        "Duplicate connections are not allowed.",
        ["edges", index]
      );
    }
    connectionPairs.add(pair);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  for (const node of definition.nodes) {
    const inbound = incoming.get(node.id) ?? 0;
    const outbound = outgoing.get(node.id)?.length ?? 0;
    if (node.kind === "INPUT" && inbound !== 0)
      throw new WorkflowDefinitionError(
        "workflow_input_connected",
        "The input node cannot have incoming connections.",
        ["nodes"]
      );
    if (node.kind !== "INPUT" && inbound !== 1)
      throw new WorkflowDefinitionError(
        "workflow_input_count",
        "Every non-input node requires exactly one incoming connection.",
        ["nodes"]
      );
    if (node.kind === "OUTPUT" && outbound !== 0)
      throw new WorkflowDefinitionError(
        "workflow_output_connected",
        "The output node cannot have outgoing connections.",
        ["nodes"]
      );
    if (node.kind !== "OUTPUT" && (outbound < 1 || outbound > 4))
      throw new WorkflowDefinitionError(
        "workflow_fanout",
        "Every non-output node needs one to four outgoing connections.",
        ["nodes"]
      );
  }
  const ordered = topologicalNodes(definition);
  if (ordered.length !== definition.nodes.length) {
    throw new WorkflowDefinitionError(
      "workflow_cycle",
      "Cycles are not supported in controlled workflows.",
      ["edges"]
    );
  }
  const reachable = new Set<string>();
  const visit = [inputNodes[0]!.id];
  while (visit.length) {
    const id = visit.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    visit.push(...(outgoing.get(id) ?? []));
  }
  if (reachable.size !== definition.nodes.length) {
    throw new WorkflowDefinitionError(
      "workflow_unreachable_node",
      "Every node must be reachable from the input node.",
      ["nodes"]
    );
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
