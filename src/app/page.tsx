import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  FileSearch,
  Fingerprint,
  MessageSquareText,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "A workspace for deliberate intelligence",
  description:
    "NEXUS AI brings conversations, private documents, durable knowledge, and governed workflows into one secure workspace.",
  alternates: { canonical: "/" }
};

const featureGroups = [
  {
    code: "01 / THINK",
    icon: MessageSquareText,
    title: "Conversations with a memory",
    description:
      "Keep investigations coherent across sessions, sources, and decisions without losing the thread.",
    status: "Planned"
  },
  {
    code: "02 / GROUND",
    icon: FileSearch,
    title: "Private documents, visible evidence",
    description:
      "Work from your own material with clear processing states and source-level provenance.",
    status: "Planned"
  },
  {
    code: "03 / RETAIN",
    icon: BookOpen,
    title: "Knowledge that outlives the chat",
    description:
      "Promote useful findings into a searchable knowledge layer instead of burying them in history.",
    status: "Planned"
  },
  {
    code: "04 / REPEAT",
    icon: Workflow,
    title: "Workflows with guardrails",
    description:
      "Turn repeatable thinking into constrained, versioned processes with an auditable execution trail.",
    status: "Planned"
  }
] as const;

const process = [
  {
    number: "01",
    title: "Bring the context",
    description: "Start from a focused question, a private source, or durable workspace knowledge."
  },
  {
    number: "02",
    title: "Trace the reasoning",
    description:
      "Keep evidence, status, and uncertainty visible while work moves through the system."
  },
  {
    number: "03",
    title: "Keep what matters",
    description:
      "Carry a useful outcome into knowledge or a repeatable workflow—with provenance intact."
  }
] as const;

export default function HomePage() {
  return (
    <div className={styles.page}>
      <PageShell>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <StatusPill tone="info">Foundation access is open</StatusPill>
            <p className={styles.heroCode}>NXS / A coherent workspace for serious work</p>
            <h1 id="hero-title">
              Your work deserves a <em>memory,</em> not another tab.
            </h1>
            <p className={styles.heroLead}>
              NEXUS AI is a private workspace being built to connect conversations, documents,
              knowledge, and repeatable workflows—so context compounds instead of disappearing.
            </p>
            <div className={styles.heroActions}>
              <ButtonLink
                href="/auth/register"
                size="large"
                trailingIcon={<Icon icon={ArrowRight} />}
              >
                Create your workspace
              </ButtonLink>
              <ButtonLink href="/design-system" variant="secondary" size="large">
                Explore the interface
              </ButtonLink>
            </div>
            <p className={styles.releaseNote}>
              <Icon icon={ShieldCheck} />
              Secure accounts, verified email, database sessions, and private workspace boundaries
              are live today. Intelligence features arrive in measured phases.
            </p>
          </div>

          <InterfaceStudy />
        </section>
      </PageShell>

      <section className={styles.signalBand} aria-label="Available foundation capabilities">
        <PageShell className={styles.signalBandInner}>
          <span>Available now</span>
          <ul>
            <li>
              <Icon icon={Check} /> Verified identity
            </li>
            <li>
              <Icon icon={Check} /> Private workspace
            </li>
            <li>
              <Icon icon={Check} /> Tenant-safe data boundary
            </li>
            <li>
              <Icon icon={Check} /> Session controls
            </li>
          </ul>
        </PageShell>
      </section>

      <PageShell>
        <section className={styles.introduction} id="product" aria-labelledby="product-title">
          <div className={styles.sectionMarker}>
            <span>01</span>
            <p>Product thesis</p>
          </div>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>Context becomes a system</p>
            <h2 id="product-title">One place to ask, inspect, retain, and repeat.</h2>
            <p>
              Most AI tools optimize the next answer. NEXUS is designed around the work that
              survives it: the source, the decision, the reusable insight, and the process that
              should run the same way next time.
            </p>
          </div>
          <div className={styles.contextMap} aria-label="NEXUS product model">
            <div className={styles.mapCore}>
              <span>NXS</span>
              <strong>Workspace context</strong>
            </div>
            <div className={styles.mapNode} data-position="one">
              <Icon icon={MessageSquareText} />
              <span>Converse</span>
            </div>
            <div className={styles.mapNode} data-position="two">
              <Icon icon={FileSearch} />
              <span>Ground</span>
            </div>
            <div className={styles.mapNode} data-position="three">
              <Icon icon={BookOpen} />
              <span>Retain</span>
            </div>
            <div className={styles.mapNode} data-position="four">
              <Icon icon={Workflow} />
              <span>Repeat</span>
            </div>
          </div>
        </section>

        <section className={styles.features} id="features" aria-labelledby="features-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>The connected workspace</p>
              <h2 id="features-title">Four surfaces. One durable thread.</h2>
            </div>
            <p>
              Each surface shares the same workspace boundary and makes availability explicit.
              Planned capabilities are shown as planned—not simulated as finished product.
            </p>
          </div>
          <div className={styles.featureGrid}>
            {featureGroups.map((feature) => (
              <article key={feature.code} className={styles.featureCard}>
                <div className={styles.featureMeta}>
                  <span>{feature.code}</span>
                  <span>{feature.status}</span>
                </div>
                <div className={styles.featureIcon} aria-hidden="true">
                  <Icon icon={feature.icon} size={24} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.productFrame} aria-labelledby="frame-title">
          <div className={styles.frameHeader}>
            <div>
              <span>Original interface study / 02</span>
              <h2 id="frame-title">Evidence stays close to the answer.</h2>
            </div>
            <StatusPill tone="neutral">Concept surface</StatusPill>
          </div>
          <div className={styles.frameBody}>
            <div className={styles.frameRail}>
              <span className={styles.miniMark}>N</span>
              <span className={styles.railActive}>
                <Icon icon={Sparkles} />
              </span>
              <span>
                <Icon icon={FileSearch} />
              </span>
              <span>
                <Icon icon={Network} />
              </span>
              <span>
                <Icon icon={Braces} />
              </span>
            </div>
            <div className={styles.frameConversation}>
              <div className={styles.framePrompt}>
                <span>Research thread</span>
                <p>Which assumptions shape this launch decision?</p>
              </div>
              <div className={styles.frameResponse}>
                <div className={styles.answerMark}>NXS</div>
                <div>
                  <span>Evidence synthesis</span>
                  <h3>The decision turns on three assumptions.</h3>
                  <p>
                    Demand is credible, but the adoption window and operating constraint remain
                    uncertain. Validate those two signals before expanding the commitment.
                  </p>
                  <div className={styles.evidenceChips}>
                    <span>[1] Research brief · p. 8</span>
                    <span>[2] Interview notes · 14</span>
                  </div>
                </div>
              </div>
            </div>
            <aside className={styles.frameEvidence}>
              <span>Evidence / 02</span>
              <article>
                <strong>Research brief</strong>
                <p>Demand signals are consistent across three segments.</p>
              </article>
              <article>
                <strong>Interview notes</strong>
                <p>Adoption depends on integration effort remaining bounded.</p>
              </article>
              <small>Illustrative product direction. No generated output.</small>
            </aside>
          </div>
        </section>

        <section className={styles.process} id="process" aria-labelledby="process-title">
          <div className={styles.sectionMarker}>
            <span>02</span>
            <p>How it works</p>
          </div>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>A deliberate loop</p>
              <h2 id="process-title">From context to capability.</h2>
            </div>
            <p>
              NEXUS keeps the path legible: what entered the system, what happened to it, and what
              became reusable.
            </p>
          </div>
          <ol className={styles.processList}>
            {process.map((step) => (
              <li key={step.number}>
                <span>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
                <Icon icon={ArrowRight} />
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.cta} aria-labelledby="cta-title">
          <div className={styles.ctaSignal} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className={styles.eyebrow}>Start with a secure foundation</p>
            <h2 id="cta-title">Build a workspace your future work can trust.</h2>
            <p>
              Create an account now. Your verified, private workspace is ready while the connected
              intelligence layer is built in public, phase by phase.
            </p>
          </div>
          <div className={styles.ctaActions}>
            <ButtonLink
              href="/auth/register"
              size="large"
              trailingIcon={<Icon icon={ArrowRight} />}
            >
              Create account
            </ButtonLink>
            <Link href="/auth/login">Already have a workspace? Sign in</Link>
          </div>
        </section>
      </PageShell>
    </div>
  );
}

function InterfaceStudy() {
  return (
    <aside className={styles.interfaceStudy} aria-label="Original NEXUS interface illustration">
      <div className={styles.studyTopbar}>
        <div>
          <span className={styles.studyMark}>N</span>
          <span>Research signal</span>
        </div>
        <span>Interface study / 01</span>
      </div>
      <div className={styles.studyBody}>
        <div className={styles.studySidebar} aria-hidden="true">
          <span data-active="true" />
          <span />
          <span />
          <span />
        </div>
        <div className={styles.studyConversation}>
          <span className={styles.studyLabel}>Active inquiry</span>
          <h2>Map the decision, not just the answer.</h2>
          <div className={styles.studyQuestion}>
            <span>YOU</span>
            <p>What evidence should change our launch sequence?</p>
          </div>
          <div className={styles.studyAnswer}>
            <span>NXS</span>
            <div>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className={styles.studySources}>
            <span>3 evidence links</span>
            <span>1 open assumption</span>
          </div>
        </div>
      </div>
      <div className={styles.studyFooter}>
        <Fingerprint size={16} aria-hidden="true" />
        Illustrative product direction · not live AI output
      </div>
    </aside>
  );
}
