"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Braces,
  CirclePlay,
  Clock3,
  FileOutput,
  GitBranch,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, SelectField, TextAreaField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./workflows.module.css";

type NodeKind = "INPUT" | "TEMPLATE" | "AI_PROMPT" | "OUTPUT";
type WorkflowNode = {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  config: Record<string, string>;
};
type WorkflowEdge = { id: string; source: string; target: string };
type Definition = {
  schemaVersion: "nexus.workflow.v1";
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
interface Execution {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
  readonly output: { readonly text?: string } | null;
  readonly capabilities: { readonly cancel: boolean };
}
interface VersionSummary {
  readonly id?: string;
  readonly versionNumber: number;
  readonly definition?: unknown;
  readonly publishedAt: string | null;
}

export function WorkflowStudio({
  workspaceId,
  workflow,
  executions,
  models,
  canAuthor
}: {
  readonly workspaceId: string;
  readonly workflow: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: string;
    readonly etag: string;
    readonly activeVersionId: string | null;
    readonly latestVersion?: VersionSummary | null;
    readonly activeVersion?: VersionSummary | null;
  };
  readonly executions: readonly Execution[];
  readonly models: readonly { readonly key: string; readonly label: string }[];
  readonly canAuthor: boolean;
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState<Definition>(() =>
    normalizeDefinition(workflow.latestVersion?.definition, models[0]?.key ?? "mock/nexus-dev")
  );
  const [selectedId, setSelectedId] = useState(definition.nodes[0]?.id ?? "input");
  const [savedVersion, setSavedVersion] = useState<VersionSummary | null>(
    workflow.latestVersion ?? null
  );
  const [source, setSource] = useState(definition.nodes[0]?.id ?? "");
  const [target, setTarget] = useState(definition.nodes[1]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
    null
  );
  const [logs, setLogs] = useState<Record<string, readonly ExecutionLog[]>>({});
  const selected = definition.nodes.find((node) => node.id === selectedId) ?? definition.nodes[0];
  const canvasWidth = Math.max(900, ...definition.nodes.map((node) => node.position.x + 240));

  const graphSummary = useMemo(() => {
    const aiNodes = definition.nodes.filter((node) => node.kind === "AI_PROMPT").length;
    return `${definition.nodes.length} nodes · ${definition.edges.length} connections · ${aiNodes} AI step${aiNodes === 1 ? "" : "s"}`;
  }, [definition]);

  function updateNode(id: string, change: (node: WorkflowNode) => WorkflowNode) {
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? change(node) : node))
    }));
  }

  function addNode(kind: "TEMPLATE" | "AI_PROMPT") {
    const output = definition.nodes.find((node) => node.kind === "OUTPUT");
    if (!output) return;
    const incoming = definition.edges.find((edge) => edge.target === output.id);
    const id = `${kind.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = {
      id,
      kind,
      position: { x: Math.max(220, output.position.x - 180), y: output.position.y },
      config:
        kind === "TEMPLATE"
          ? { template: "{{previous}}" }
          : {
              instruction: "Respond clearly and only from the supplied workflow value.",
              modelKey: models[0]?.key ?? "mock/nexus-dev"
            }
    };
    setDefinition((current) => ({
      ...current,
      nodes: [
        ...current.nodes.map((item) =>
          item.kind === "OUTPUT"
            ? { ...item, position: { ...item.position, x: item.position.x + 220 } }
            : item
        ),
        node
      ],
      edges: [
        ...current.edges.filter((edge) => edge !== incoming),
        ...(incoming
          ? [
              {
                id: `edge-${crypto.randomUUID().slice(0, 8)}`,
                source: incoming.source,
                target: id
              },
              { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source: id, target: incoming.target }
            ]
          : [])
      ]
    }));
    setSelectedId(id);
  }

  function removeNode(id: string) {
    const node = definition.nodes.find((item) => item.id === id);
    if (!node || node.kind === "INPUT" || node.kind === "OUTPUT") return;
    const incoming = definition.edges.find((edge) => edge.target === id);
    const outgoing = definition.edges.filter((edge) => edge.source === id);
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.filter((item) => item.id !== id),
      edges: [
        ...current.edges.filter((edge) => edge.source !== id && edge.target !== id),
        ...(incoming && outgoing.length === 1
          ? [
              {
                id: `edge-${crypto.randomUUID().slice(0, 8)}`,
                source: incoming.source,
                target: outgoing[0]!.target
              }
            ]
          : [])
      ]
    }));
    setSelectedId(definition.nodes.find((item) => item.kind === "INPUT")?.id ?? "input");
  }

  function addConnection() {
    if (!source || !target || source === target) return;
    setDefinition((current) => ({
      ...current,
      edges: [
        ...current.edges.filter((edge) => edge.target !== target),
        { id: `edge-${crypto.randomUUID().slice(0, 8)}`, source, target }
      ]
    }));
  }

  async function saveVersion() {
    setBusy("save");
    setFeedback(null);
    try {
      const version = await api<VersionSummary>(
        `/api/v1/workspaces/${workspaceId}/workflows/${workflow.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schemaVersion: definition.schemaVersion, definition })
        }
      );
      setSavedVersion(version);
      setFeedback({
        tone: "success",
        message: `Version ${version.versionNumber} saved immutably.`
      });
      router.refresh();
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function publishVersion() {
    if (!savedVersion?.id) return;
    setBusy("publish");
    setFeedback(null);
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/workflows/${workflow.id}/versions/${savedVersion.id}/publication`,
        { method: "POST" }
      );
      setFeedback({
        tone: "success",
        message: `Version ${savedVersion.versionNumber} is now active.`
      });
      router.refresh();
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function updateMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("metadata");
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/v1/workspaces/${workspaceId}/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": workflow.etag },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? "") || null
        })
      });
      setFeedback({ tone: "success", message: "Workflow metadata updated." });
      router.refresh();
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("run");
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    try {
      const execution = await api<Execution>(
        `/api/v1/workspaces/${workspaceId}/workflows/${workflow.id}/executions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ input: { text: String(data.get("input") ?? "") } })
        }
      );
      setFeedback({ tone: "success", message: `Execution ${execution.id.slice(0, 8)} queued.` });
      router.refresh();
      window.setTimeout(() => router.refresh(), 800);
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel(executionId: string) {
    setBusy(`cancel:${executionId}`);
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/workflow-executions/${executionId}/cancellation`,
        { method: "POST" }
      );
      router.refresh();
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function loadLogs(executionId: string) {
    setBusy(`logs:${executionId}`);
    try {
      const result = await api<readonly ExecutionLog[]>(
        `/api/v1/workspaces/${workspaceId}/workflow-executions/${executionId}/logs?limit=100`
      );
      setLogs((current) => ({ ...current, [executionId]: result }));
    } catch (reason) {
      setFeedback({ tone: "error", message: message(reason) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={styles.studio}>
      <header className={styles.studioHeader}>
        <div>
          <ButtonLink href={"/workflows" as Route} variant="ghost" size="small">
            ← Workflow library
          </ButtonLink>
          <p className={styles.eyebrow}>WORKFLOW STUDIO / {workflow.id.slice(0, 8)}</p>
          <div className={styles.titleLine}>
            <h1>{workflow.name}</h1>
            <StatusPill tone={statusTone(workflow.status)}>{titleCase(workflow.status)}</StatusPill>
          </div>
          <p>
            {workflow.description ?? "Add a purpose statement to make the graph easier to review."}
          </p>
        </div>
        <div className={styles.studioActions}>
          <span>
            <ShieldCheck /> CONTROLLED ENGINE
          </span>
          {canAuthor ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void saveVersion()}
                loading={busy === "save"}
                loadingLabel="Saving"
                leadingIcon={<Icon icon={Save} />}
              >
                Save version
              </Button>
              <Button
                onClick={() => void publishVersion()}
                disabled={!savedVersion?.id}
                loading={busy === "publish"}
                loadingLabel="Publishing"
                leadingIcon={<Icon icon={Send} />}
              >
                Publish v{savedVersion?.versionNumber ?? "—"}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {feedback ? (
        <p
          className={styles.feedback}
          data-tone={feedback.tone}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      <section className={styles.canvasSection} aria-labelledby="graph-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>VISUAL GRAPH / {graphSummary}</p>
            <h2 id="graph-title">Execution canvas</h2>
          </div>
          {canAuthor ? (
            <div className={styles.addActions}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => addNode("TEMPLATE")}
                leadingIcon={<Icon icon={Braces} />}
              >
                Text template
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={() => addNode("AI_PROMPT")}
                leadingIcon={<Icon icon={Bot} />}
              >
                AI prompt
              </Button>
            </div>
          ) : null}
        </div>
        <div className={styles.canvasViewport}>
          <div className={styles.nodeCanvas} style={{ width: canvasWidth }}>
            <svg viewBox={`0 0 ${canvasWidth} 340`} aria-hidden="true">
              <defs>
                <marker
                  id="workflow-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L7,3 z" />
                </marker>
              </defs>
              {definition.edges.map((edge) => {
                const from = definition.nodes.find((node) => node.id === edge.source);
                const to = definition.nodes.find((node) => node.id === edge.target);
                if (!from || !to) return null;
                return (
                  <path
                    key={edge.id}
                    d={`M ${from.position.x + 184} ${from.position.y + 58} C ${from.position.x + 220} ${from.position.y + 58}, ${to.position.x - 36} ${to.position.y + 58}, ${to.position.x} ${to.position.y + 58}`}
                    markerEnd="url(#workflow-arrow)"
                  />
                );
              })}
            </svg>
            {definition.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={styles.nodeCard}
                data-selected={node.id === selectedId || undefined}
                data-kind={node.kind}
                style={{ left: node.position.x, top: node.position.y }}
                onClick={() => setSelectedId(node.id)}
                aria-pressed={node.id === selectedId}
              >
                <span>{nodeIcon(node.kind)}</span>
                <small>{node.kind.replace("_", " ")}</small>
                <strong>{nodeLabel(node)}</strong>
                <em>{node.id}</em>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className={styles.editorGrid}>
        <section className={styles.panel} aria-labelledby="node-config-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>NODE CONFIGURATION</p>
              <h2 id="node-config-title">{selected ? nodeLabel(selected) : "Select a node"}</h2>
            </div>
            {selected && canAuthor ? (
              <div className={styles.positionActions} aria-label="Move selected node">
                {[
                  [ArrowLeft, -40, 0, "Move left"],
                  [ArrowRight, 40, 0, "Move right"],
                  [ArrowUp, 0, -30, "Move up"],
                  [ArrowDown, 0, 30, "Move down"]
                ].map(([MoveIcon, x, y, label]) => (
                  <Button
                    key={String(label)}
                    size="small"
                    variant="ghost"
                    aria-label={String(label)}
                    onClick={() =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        position: {
                          x: Math.max(20, Math.min(9_000, node.position.x + Number(x))),
                          y: Math.max(20, Math.min(220, node.position.y + Number(y)))
                        }
                      }))
                    }
                  >
                    <Icon icon={MoveIcon as typeof ArrowLeft} />
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {selected ? (
            <div className={styles.configFields}>
              {selected.kind === "TEMPLATE" ? (
                <TextAreaField
                  label="Literal text template"
                  hint="Only {{input}} and {{previous}} are replaced. Expressions are never evaluated."
                  value={selected.config.template ?? ""}
                  disabled={!canAuthor}
                  rows={7}
                  maxLength={4_000}
                  onChange={(event) =>
                    updateNode(selected.id, (node) => ({
                      ...node,
                      config: { ...node.config, template: event.target.value }
                    }))
                  }
                />
              ) : null}
              {selected.kind === "AI_PROMPT" ? (
                <>
                  <TextAreaField
                    label="Bounded instruction"
                    hint="The workflow value is sent as untrusted data. No tools are available to this node."
                    value={selected.config.instruction ?? ""}
                    disabled={!canAuthor}
                    rows={7}
                    maxLength={4_000}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: { ...node.config, instruction: event.target.value }
                      }))
                    }
                  />
                  <SelectField
                    label="Approved model"
                    value={selected.config.modelKey ?? models[0]?.key}
                    disabled={!canAuthor}
                    onChange={(event) =>
                      updateNode(selected.id, (node) => ({
                        ...node,
                        config: { ...node.config, modelKey: event.target.value }
                      }))
                    }
                  >
                    {models.map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label}
                      </option>
                    ))}
                  </SelectField>
                </>
              ) : null}
              {selected.kind === "INPUT" || selected.kind === "OUTPUT" ? (
                <FormField
                  label="Display label"
                  value={selected.config.label ?? ""}
                  disabled={!canAuthor}
                  maxLength={80}
                  onChange={(event) =>
                    updateNode(selected.id, (node) => ({
                      ...node,
                      config: { ...node.config, label: event.target.value }
                    }))
                  }
                />
              ) : null}
              {selected.kind !== "INPUT" && selected.kind !== "OUTPUT" && canAuthor ? (
                <Button
                  variant="danger"
                  size="small"
                  onClick={() => removeNode(selected.id)}
                  leadingIcon={<Icon icon={Trash2} />}
                >
                  Remove node
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className={styles.panel} aria-labelledby="connections-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>TYPED EDGES</p>
              <h2 id="connections-title">Connections</h2>
            </div>
            <Icon icon={Link2} />
          </div>
          {canAuthor ? (
            <div className={styles.connectionBuilder}>
              <SelectField
                label="From"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                {definition.nodes
                  .filter((node) => node.kind !== "OUTPUT")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {nodeLabel(node)}
                    </option>
                  ))}
              </SelectField>
              <SelectField
                label="To"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {definition.nodes
                  .filter((node) => node.kind !== "INPUT")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {nodeLabel(node)}
                    </option>
                  ))}
              </SelectField>
              <Button
                size="small"
                variant="secondary"
                onClick={addConnection}
                leadingIcon={<Icon icon={Plus} />}
              >
                Connect
              </Button>
            </div>
          ) : null}
          <ol className={styles.edgeList}>
            {definition.edges.map((edge, index) => (
              <li key={edge.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{edge.source}</code>
                <strong>→</strong>
                <code>{edge.target}</code>
                {canAuthor ? (
                  <Button
                    size="small"
                    variant="ghost"
                    aria-label={`Remove connection from ${edge.source} to ${edge.target}`}
                    onClick={() =>
                      setDefinition((current) => ({
                        ...current,
                        edges: current.edges.filter((item) => item.id !== edge.id)
                      }))
                    }
                  >
                    <Icon icon={Trash2} />
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className={styles.runGrid}>
        <section className={styles.panel} aria-labelledby="run-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>PUBLISHED VERSION ONLY</p>
              <h2 id="run-title">Run workflow</h2>
            </div>
            <Icon icon={CirclePlay} />
          </div>
          <form className={styles.runForm} onSubmit={(event) => void run(event)}>
            <TextAreaField
              label="Workflow input"
              name="input"
              required
              maxLength={16_000}
              rows={7}
              placeholder="Provide the input value for this controlled run…"
            />
            <Button
              type="submit"
              disabled={workflow.status !== "ACTIVE"}
              loading={busy === "run"}
              loadingLabel="Queueing"
              leadingIcon={<Icon icon={CirclePlay} />}
            >
              {workflow.status === "ACTIVE" ? "Queue execution" : "Publish before running"}
            </Button>
          </form>
        </section>

        {canAuthor ? (
          <section className={styles.panel} aria-labelledby="metadata-title">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>WORKFLOW METADATA</p>
                <h2 id="metadata-title">Identity and purpose</h2>
              </div>
              <Icon icon={GitBranch} />
            </div>
            <form className={styles.runForm} onSubmit={(event) => void updateMetadata(event)}>
              <FormField
                label="Name"
                name="name"
                defaultValue={workflow.name}
                minLength={2}
                maxLength={120}
                required
              />
              <TextAreaField
                label="Purpose"
                name="description"
                defaultValue={workflow.description ?? ""}
                maxLength={500}
                rows={4}
                optional
              />
              <Button
                type="submit"
                variant="secondary"
                loading={busy === "metadata"}
                loadingLabel="Saving"
              >
                Save metadata
              </Button>
            </form>
          </section>
        ) : null}
      </div>

      <section className={styles.history} aria-labelledby="history-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>AUDITABLE RUNS / ACTUAL DATABASE RECORDS</p>
            <h2 id="history-title">Execution history</h2>
          </div>
          <Button
            variant="ghost"
            size="small"
            onClick={() => router.refresh()}
            leadingIcon={<Icon icon={RefreshCw} />}
          >
            Refresh state
          </Button>
        </div>
        {executions.length ? (
          <div className={styles.executionList}>
            {executions.map((execution) => (
              <article key={execution.id}>
                <header>
                  <span className={styles.executionGlyph}>
                    <Icon icon={Clock3} />
                  </span>
                  <div>
                    <strong>{execution.id.slice(0, 8)}</strong>
                    <small>{formatDate(execution.createdAt)}</small>
                  </div>
                  <StatusPill tone={executionTone(execution.status)}>
                    {titleCase(execution.status)}
                  </StatusPill>
                  <div className={styles.executionActions}>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => void loadLogs(execution.id)}
                      loading={busy === `logs:${execution.id}`}
                      loadingLabel="Loading"
                    >
                      Logs
                    </Button>
                    {execution.capabilities.cancel ? (
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => void cancel(execution.id)}
                        loading={busy === `cancel:${execution.id}`}
                        loadingLabel="Stopping"
                        leadingIcon={<Icon icon={Square} />}
                      >
                        Stop
                      </Button>
                    ) : null}
                  </div>
                </header>
                {execution.output?.text ? <pre>{execution.output.text}</pre> : null}
                {execution.errorCode ? (
                  <p className={styles.safeError}>Safe error: {execution.errorCode}</p>
                ) : null}
                {logs[execution.id] ? (
                  <ol className={styles.logList}>
                    {logs[execution.id]!.map((log) => (
                      <li key={log.sequence}>
                        <span>{log.sequence}</span>
                        <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
                        <strong>{log.event}</strong>
                        <p>{log.message}</p>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <Icon icon={Clock3} />
            <h3>No executions yet</h3>
            <p>Publish a valid graph, then queue the first controlled run.</p>
          </div>
        )}
      </section>
    </main>
  );
}

interface ExecutionLog {
  readonly sequence: string;
  readonly event: string;
  readonly message: string;
  readonly createdAt: string;
}

function normalizeDefinition(value: unknown, modelKey: string): Definition {
  if (
    value &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === "nexus.workflow.v1" &&
    Array.isArray((value as { nodes?: unknown }).nodes) &&
    Array.isArray((value as { edges?: unknown }).edges)
  ) {
    return value as Definition;
  }
  return {
    schemaVersion: "nexus.workflow.v1",
    nodes: [
      {
        id: "input",
        kind: "INPUT",
        position: { x: 60, y: 110 },
        config: { label: "Workflow input" }
      },
      {
        id: "prompt",
        kind: "AI_PROMPT",
        position: { x: 350, y: 110 },
        config: {
          instruction: "Respond clearly and only from the supplied workflow value.",
          modelKey
        }
      },
      {
        id: "output",
        kind: "OUTPUT",
        position: { x: 650, y: 110 },
        config: { label: "Workflow output" }
      }
    ],
    edges: [
      { id: "edge-input-prompt", source: "input", target: "prompt" },
      { id: "edge-prompt-output", source: "prompt", target: "output" }
    ]
  };
}

function nodeLabel(node: WorkflowNode) {
  if (node.kind === "INPUT" || node.kind === "OUTPUT") return node.config.label ?? node.kind;
  if (node.kind === "TEMPLATE") return "Compose text";
  return "AI prompt";
}
function nodeIcon(kind: NodeKind) {
  return (
    <Icon
      icon={
        kind === "AI_PROMPT"
          ? Bot
          : kind === "TEMPLATE"
            ? Braces
            : kind === "OUTPUT"
              ? FileOutput
              : GitBranch
      }
    />
  );
}
async function api<T = unknown>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    detail?: string;
    errors?: { message: string }[];
  } | null;
  if (!response.ok)
    throw new Error(
      payload?.errors?.[0]?.message ?? payload?.detail ?? "The request could not be completed."
    );
  return payload?.data as T;
}
function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase().replaceAll("_", " ");
}
function statusTone(status: string): "success" | "warning" | "neutral" {
  return status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral";
}
function executionTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED" || status === "TIMED_OUT") return "danger";
  if (status === "QUEUED" || status === "RUNNING" || status === "CANCEL_REQUESTED") return "info";
  if (status === "CANCELLED") return "warning";
  return "neutral";
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}
