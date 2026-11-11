import { describe, expect, it } from "vitest";

import {
  parseWorkflowDefinition,
  topologicalNodes,
  workflowDefinitionDigest,
  WorkflowDefinitionError
} from "@/modules/workflows/server/definition";

const limits = { maxNodes: 40, maxSteps: 100 };
const validDefinition = {
  schemaVersion: "nexus.workflow.v1" as const,
  nodes: [
    { id: "input", kind: "INPUT" as const, position: { x: 0, y: 0 }, config: { label: "Input" } },
    {
      id: "template",
      kind: "TEMPLATE" as const,
      position: { x: 200, y: 0 },
      config: { template: "Question: {{previous}}" }
    },
    {
      id: "output",
      kind: "OUTPUT" as const,
      position: { x: 400, y: 0 },
      config: { label: "Output" }
    }
  ],
  edges: [
    { id: "edge-1", source: "input", target: "template" },
    { id: "edge-2", source: "template", target: "output" }
  ]
};

describe("controlled workflow definitions", () => {
  it("accepts a bounded allow-listed graph and produces a stable digest", () => {
    const parsed = parseWorkflowDefinition(validDefinition, limits);
    expect(topologicalNodes(parsed).map((node) => node.id)).toEqual([
      "input",
      "template",
      "output"
    ]);
    expect(workflowDefinitionDigest(parsed)).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      workflowDefinitionDigest({
        edges: parsed.edges,
        nodes: parsed.nodes,
        schemaVersion: parsed.schemaVersion
      })
    ).toBe(workflowDefinitionDigest(parsed));
  });

  it.each(["CODE", "HTTP", "SHELL", "SQL", "JAVASCRIPT"])(
    "rejects the unsupported %s node kind",
    (kind) => {
      const attempted = structuredClone(validDefinition) as unknown as Record<string, unknown>;
      (attempted.nodes as Array<Record<string, unknown>>)[1] = {
        id: "danger",
        kind,
        position: { x: 200, y: 0 },
        config: { code: "process.env", url: "http://169.254.169.254" }
      };
      expect(() => parseWorkflowDefinition(attempted, limits)).toThrow(WorkflowDefinitionError);
    }
  );

  it("rejects cycles, unreachable nodes, and excessive graphs", () => {
    const cycle = structuredClone(validDefinition);
    cycle.edges = [
      { id: "edge-1", source: "input", target: "template" },
      { id: "edge-2", source: "template", target: "output" },
      { id: "edge-3", source: "output", target: "template" }
    ];
    expect(() => parseWorkflowDefinition(cycle, limits)).toThrow(WorkflowDefinitionError);

    expect(() => parseWorkflowDefinition(validDefinition, { maxNodes: 2, maxSteps: 100 })).toThrow(
      /between 2 and 2 nodes/i
    );
  });

  it("rejects executable template syntax and unknown configuration fields", () => {
    const expression = structuredClone(validDefinition);
    expression.nodes[1]!.config.template = "${globalThis.process.env}";
    expect(() => parseWorkflowDefinition(expression, limits)).toThrow(
      /Executable template syntax/i
    );

    const unknownField = structuredClone(validDefinition) as unknown as Record<string, unknown>;
    (unknownField.nodes as Array<Record<string, unknown>>)[1] = {
      ...(unknownField.nodes as Array<Record<string, unknown>>)[1],
      config: { template: "{{previous}}", fetchUrl: "https://example.test" }
    };
    expect(() => parseWorkflowDefinition(unknownField, limits)).toThrow(WorkflowDefinitionError);
  });
});
