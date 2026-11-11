"use client";

import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  Database,
  FileText,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Workflow
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { SkeletonCard } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import { Navigation } from "@/components/navigation/navigation";
import { Pagination } from "@/components/navigation/pagination";
import { ProductShell } from "@/components/navigation/sidebar";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { FormField, SelectField, TextAreaField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

import styles from "./design-system-showcase.module.css";

const shellItems = [
  { href: "/design-system", label: "Signal map", icon: <Icon icon={LayoutDashboard} /> },
  { href: "/dashboard", label: "Conversations", icon: <Icon icon={MessageSquare} />, badge: "3" },
  {
    href: "#navigation",
    label: "Documents",
    icon: <Icon icon={FileText} />
  },
  {
    href: "#navigation",
    label: "Knowledge",
    icon: <Icon icon={BookOpen} />
  },
  {
    href: "#navigation",
    label: "Workflows",
    icon: <Icon icon={Workflow} />
  },
  { href: "/settings/profile", label: "Settings", icon: <Icon icon={Settings} /> }
] as const;

const palette = [
  { name: "Void", value: "#08090D", className: styles.void },
  { name: "Carbon", value: "#11131A", className: styles.carbon },
  { name: "Signal", value: "#2457FF", className: styles.signal },
  { name: "Burgundy", value: "#650D2D", className: styles.burgundy },
  { name: "Paper", value: "#F5F5F7", className: styles.paper },
  { name: "Graphite", value: "#9297A5", className: styles.graphite }
] as const;

export function DesignSystemShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [workspace, setWorkspace] = useState("Signal room");
  const { notify } = useToast();

  return (
    <div className={styles.showcase}>
      <header className={styles.hero}>
        <div>
          <span className={styles.overline}>NXS / Interface protocol 03</span>
          <h1>Clarity at the edge of complexity.</h1>
          <p>
            A dark, high-precision system for working with intelligence—structured enough for
            operations, quiet enough for thought.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <StatusPill>System online</StatusPill>
          <span>WCAG 2.2 AA target</span>
          <span>CSS Modules · dark baseline</span>
        </div>
      </header>

      <Navigation
        className={styles.sectionNav}
        label="Design system sections"
        items={[
          { href: "#foundation", label: "Foundation" },
          { href: "#controls", label: "Controls" },
          { href: "#surfaces", label: "Surfaces" },
          { href: "#navigation", label: "Navigation" },
          { href: "#feedback", label: "Feedback" }
        ]}
      />

      <section className={styles.section} id="foundation" aria-labelledby="foundation-title">
        <SectionHeading
          number="01"
          title="Foundation"
          id="foundation-title"
          description="A restrained palette, dense operational labels, and generous reading space."
        />
        <div className={styles.palette}>
          {palette.map((color) => (
            <div className={styles.swatch} key={color.name}>
              <span className={color.className} aria-hidden="true" />
              <strong>{color.name}</strong>
              <code>{color.value}</code>
            </div>
          ))}
        </div>
        <div className={styles.typeGrid}>
          <div>
            <span className={styles.overline}>Display / precision</span>
            <p className={styles.displaySample}>One system. Many signals.</p>
          </div>
          <div>
            <span className={styles.overline}>Body / durable</span>
            <p>
              Interfaces explain what happened, what is happening now, and which action is safe to
              take next. Color reinforces meaning; it never carries meaning alone.
            </p>
          </div>
          <div>
            <span className={styles.overline}>Mono / evidence</span>
            <code className={styles.monoSample}>REQ_7F2A · 183ms · READY</code>
          </div>
        </div>
      </section>

      <section className={styles.section} id="controls" aria-labelledby="controls-title">
        <SectionHeading
          number="02"
          title="Controls"
          id="controls-title"
          description="Every control exposes hover, focus, disabled, pending, validation, and destructive states."
        />
        <div className={styles.controlGrid}>
          <Card accent="blue">
            <CardHeader eyebrow="Actions" title="Buttons" />
            <CardBody className={styles.buttonRows}>
              <div>
                <Button leadingIcon={<Icon icon={Plus} />}>New conversation</Button>
                <Button variant="secondary" leadingIcon={<Icon icon={Search} />}>
                  Search
                </Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Delete source</Button>
              </div>
              <div>
                <Button size="small">Compact</Button>
                <Button size="large" trailingIcon={<Icon icon={ArrowUpRight} />}>
                  Continue
                </Button>
                <Button loading loadingLabel="Indexing">
                  Index source
                </Button>
                <Button disabled>Unavailable</Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader eyebrow="Input" title="Fields" />
            <CardBody className={styles.formGrid}>
              <FormField
                label="Workspace name"
                defaultValue="Signal room"
                hint="Visible to workspace members."
              />
              <FormField label="Model key" defaultValue="nexus-core" disabled />
              <TextAreaField
                label="Knowledge note"
                placeholder="Capture the durable insight…"
                hint="Markdown is supported when the feature is enabled."
              />
              <SelectField label="Default scope" defaultValue="workspace">
                <option value="workspace">Current workspace</option>
                <option value="documents">Selected documents</option>
                <option value="knowledge">Knowledge only</option>
              </SelectField>
              <FormField
                label="Callback URL"
                defaultValue="javascript:alert(1)"
                error="Use an HTTPS URL from an approved origin."
              />
            </CardBody>
          </Card>
        </div>

        <div className={styles.inlineControls}>
          <DropdownMenu
            label={workspace}
            items={[
              {
                id: "signal",
                label: "Signal room",
                description: "Personal · Owner",
                selected: workspace === "Signal room",
                onSelect: () => setWorkspace("Signal room")
              },
              {
                id: "research",
                label: "Research studio",
                description: "Team · Member",
                selected: workspace === "Research studio",
                onSelect: () => setWorkspace("Research studio")
              },
              {
                id: "archive",
                label: "Archive",
                description: "Provisioning",
                disabled: true,
                onSelect: () => undefined
              }
            ]}
          />
          <Tooltip
            content="Evidence has been indexed and is ready for retrieval."
            placement="bottom"
          >
            <Button variant="ghost" aria-label="Explain ready status">
              <Icon icon={HelpCircle} />
            </Button>
          </Tooltip>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open confirmation
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Icon icon={Bell} />}
            onClick={() =>
              notify({
                title: "Knowledge saved",
                message: "The item is available to this workspace.",
                tone: "success"
              })
            }
          >
            Send toast
          </Button>
        </div>
      </section>

      <section className={styles.section} id="surfaces" aria-labelledby="surfaces-title">
        <SectionHeading
          number="03"
          title="Surfaces and data"
          id="surfaces-title"
          description="Cards organize decisions; tables preserve evidence; tabs keep related context nearby."
        />
        <div className={styles.cards}>
          <Card accent="blue" interactive>
            <CardHeader
              eyebrow="Workspace"
              title="Signal room"
              action={<StatusPill>Private</StatusPill>}
            />
            <CardBody>
              <p>A sole-owner space for conversations, sources, and durable knowledge.</p>
            </CardBody>
            <CardFooter>
              <ButtonLink
                href="/dashboard"
                variant="ghost"
                size="small"
                trailingIcon={<Icon icon={ArrowUpRight} />}
              >
                Open workspace
              </ButtonLink>
            </CardFooter>
          </Card>
          <Card accent="burgundy">
            <CardHeader
              eyebrow="Usage guardrail"
              title="Within policy"
              action={<Icon icon={Activity} />}
            />
            <CardBody>
              <p>Usage values remain estimates until provider reconciliation completes.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader eyebrow="Source index" title="24 ready" action={<Icon icon={Database} />} />
            <CardBody>
              <p>Two sources are processing. One requires attention before retrieval.</p>
            </CardBody>
          </Card>
        </div>

        <Tabs
          label="Workspace data views"
          items={[
            {
              id: "activity",
              label: "Activity",
              content: (
                <DataTable caption="Recent workspace activity">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Resource</th>
                      <th scope="col">State</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Indexed</td>
                      <td>System architecture</td>
                      <td>
                        <StatusPill>Ready</StatusPill>
                      </td>
                      <td>2 min ago</td>
                    </tr>
                    <tr>
                      <td>Updated</td>
                      <td>Research note 14</td>
                      <td>Saved</td>
                      <td>18 min ago</td>
                    </tr>
                    <tr>
                      <td>Verified</td>
                      <td>Account identity</td>
                      <td>Complete</td>
                      <td>Today</td>
                    </tr>
                  </tbody>
                </DataTable>
              )
            },
            {
              id: "policy",
              label: "Policy",
              content: (
                <p>
                  Authorization is resolved near the data and all inaccessible workspace resources
                  return the same public shape.
                </p>
              )
            },
            {
              id: "tokens",
              label: "Tokens",
              content: (
                <p>
                  Global tokens define color, typography, spacing, radius, elevation, layers, focus,
                  and motion.
                </p>
              )
            }
          ]}
        />
        <Pagination
          currentPage={2}
          totalPages={4}
          hrefForPage={(page) => `?page=${page}#surfaces`}
          label="Activity pages"
        />
      </section>

      <section className={styles.section} id="navigation" aria-labelledby="navigation-title">
        <SectionHeading
          number="04"
          title="Workspace navigation"
          id="navigation-title"
          description="A collapsible, content-first shell that becomes an off-canvas panel on small screens."
        />
        <ProductShell items={shellItems} preview>
          <div className={styles.shellContent}>
            <span className={styles.overline}>Today / Signal room</span>
            <h3>Good evening, Ada.</h3>
            <p>The workspace is quiet. Start with a question, a source, or a durable note.</p>
            <div className={styles.commandBar}>
              <Icon icon={Search} />
              <span>Search conversations, documents, and knowledge</span>
              <kbd>⌘ K</kbd>
            </div>
          </div>
        </ProductShell>
      </section>

      <section className={styles.section} id="feedback" aria-labelledby="feedback-title">
        <SectionHeading
          number="05"
          title="Feedback and recovery"
          id="feedback-title"
          description="Stable loading geometry, honest empty states, and errors with a clear recovery path."
        />
        <div className={styles.skeletonGrid}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className={styles.stateGrid}>
          <EmptyState
            title="No knowledge items yet"
            description="Save a durable insight here when a conversation or source is worth returning to."
            action={<Button leadingIcon={<Icon icon={Plus} />}>Create knowledge item</Button>}
          />
          <ErrorState
            title="Source processing paused"
            description="The original file is safe. Review the format, then retry the processing run."
            errorId="DOC_7F2A"
            action={<Button variant="secondary">Review source</Button>}
          />
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Remove this source?"
        description="The source enters recoverable deletion. Derived index entries will no longer be available."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Keep source
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setModalOpen(false);
                notify({ title: "Source scheduled for deletion", tone: "info" });
              }}
            >
              Remove source
            </Button>
          </>
        }
      >
        <p>This action is auditable and can be restored during the approved recovery window.</p>
      </Modal>
    </div>
  );
}

function SectionHeading({
  number,
  title,
  id,
  description
}: {
  readonly number: string;
  readonly title: string;
  readonly id: string;
  readonly description: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <span>{number}</span>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}
