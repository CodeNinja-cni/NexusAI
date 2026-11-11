import "server-only";

import { createHash } from "node:crypto";

import nodemailer from "nodemailer";
import { z } from "zod";

import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";

const authEmailPayloadSchema = z.object({
  template: z.enum(["VERIFY_EMAIL", "RESET_PASSWORD"]),
  to: z.email(),
  name: z.string().max(120),
  url: z.url()
});

const deletionEmailPayloadSchema = z.object({
  template: z.literal("ACCOUNT_DELETION_CANCELLATION"),
  to: z.email(),
  name: z.string().max(120),
  url: z.url(),
  scheduledFor: z.iso.datetime()
});

const workspaceInvitationEmailPayloadSchema = z.object({
  template: z.literal("WORKSPACE_INVITATION"),
  to: z.email(),
  name: z.string().max(320),
  inviterName: z.string().max(120),
  workspaceName: z.string().max(120),
  url: z.url()
});

const emailPayloadSchema = z.union([
  authEmailPayloadSchema,
  deletionEmailPayloadSchema,
  workspaceInvitationEmailPayloadSchema
]);

export type AuthEmailTemplate = z.infer<typeof authEmailPayloadSchema>["template"];

interface QueueAuthEmailInput {
  readonly template: AuthEmailTemplate;
  readonly to: string;
  readonly name: string;
  readonly url: string;
}

function createTransport() {
  const environment = getServerEnvironment();
  const { smtp } = environment;
  const deployed = environment.appEnvironment !== "local" && environment.appEnvironment !== "test";
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: deployed && !smtp.secure,
    tls: { minVersion: "TLSv1.2" },
    ...(smtp.user && smtp.password ? { auth: { user: smtp.user, pass: smtp.password } } : {})
  });
}

function emailContent(payload: z.infer<typeof emailPayloadSchema>) {
  if (payload.template === "WORKSPACE_INVITATION") {
    return {
      subject: `Join ${payload.workspaceName} on NEXUS AI`,
      text: `Hello,\n\n${payload.inviterName} invited you to join ${payload.workspaceName} on NEXUS AI.\n${payload.url}\n\nThis link expires in 7 days. Sign in with ${payload.to} to accept it.`,
      html: `<p>Hello,</p><p>${escapeHtml(payload.inviterName)} invited you to join <strong>${escapeHtml(payload.workspaceName)}</strong> on NEXUS AI.</p><p><a href="${escapeHtml(payload.url)}">Review invitation</a></p><p>This link expires in 7 days. Sign in with ${escapeHtml(payload.to)} to accept it.</p>`
    };
  }

  if (payload.template === "ACCOUNT_DELETION_CANCELLATION") {
    return {
      subject: "Your NEXUS AI account deletion is scheduled",
      text: `Hello ${payload.name},\n\nYour NEXUS AI account is scheduled for deletion on or after ${payload.scheduledFor}.\n\nIf you change your mind, use this single-use cancellation link before deletion begins:\n${payload.url}\n\nIf you did not request this, cancel immediately and reset your password.`,
      html: `<p>Hello ${escapeHtml(payload.name)},</p><p>Your NEXUS AI account is scheduled for deletion on or after <strong>${escapeHtml(payload.scheduledFor)}</strong>.</p><p>If you change your mind, use this single-use link before deletion begins:</p><p><a href="${escapeHtml(payload.url)}">Cancel account deletion</a></p><p>If you did not request this, cancel immediately and reset your password.</p>`
    };
  }

  const { template, name, url } = payload;
  if (template === "VERIFY_EMAIL") {
    return {
      subject: "Verify your NEXUS AI email",
      text: `Hello ${name},\n\nVerify your email address to activate your NEXUS AI workspace:\n${url}\n\nThis link expires in 24 hours.`,
      html: `<p>Hello ${escapeHtml(name)},</p><p>Verify your email address to activate your NEXUS AI workspace.</p><p><a href="${escapeHtml(url)}">Verify email</a></p><p>This link expires in 24 hours.</p>`
    };
  }

  return {
    subject: "Reset your NEXUS AI password",
    text: `Hello ${name},\n\nReset your NEXUS AI password:\n${url}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Use the link below to reset your NEXUS AI password.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, ignore this email.</p>`
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function deduplicationKey(input: QueueAuthEmailInput) {
  return createHash("sha256")
    .update(`${input.template}:${input.to.toLowerCase()}:${input.url}`)
    .digest("hex");
}

export async function queueAuthEmail(input: QueueAuthEmailInput): Promise<void> {
  const payload = authEmailPayloadSchema.parse(input);
  const event = await prisma.outboxEvent.upsert({
    where: { deduplicationKey: deduplicationKey(input) },
    create: {
      deduplicationKey: deduplicationKey(input),
      topic: "auth.email.send",
      aggregateType: "user_email",
      aggregateId: createHash("sha256").update(payload.to.toLowerCase()).digest("hex"),
      payload,
      status: "PENDING"
    },
    update: {},
    select: { id: true, status: true }
  });

  if (event.status !== "PUBLISHED") {
    await dispatchAuthEmailEvent(event.id);
  }
}

export async function dispatchAuthEmailEvent(eventId: string): Promise<void> {
  const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
  if (
    !event ||
    !["auth.email.send", "workspace.invitation.email.send"].includes(event.topic) ||
    event.status === "PUBLISHED"
  )
    return;

  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      id: event.id,
      status: { in: ["PENDING", "FAILED"] },
      availableAt: { lte: new Date() }
    },
    data: { availableAt: new Date(Date.now() + 5 * 60 * 1000) }
  });
  if (claimed.count !== 1) return;

  const parsedPayload = emailPayloadSchema.safeParse(event.payload);
  if (!parsedPayload.success) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastErrorRedacted: "invalid_email_payload"
      }
    });
    return;
  }

  const environment = getServerEnvironment();
  const content = emailContent(parsedPayload.data);

  try {
    await createTransport().sendMail({
      from: environment.smtp.from,
      to: parsedPayload.data.to,
      ...content
    });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "PUBLISHED",
        attempts: { increment: 1 },
        publishedAt: new Date(),
        lastErrorRedacted: null,
        // Delivery links contain one-time credentials. Keep them only while the
        // event is retryable, then replace the payload with non-sensitive metadata.
        payload: { template: parsedPayload.data.template, delivered: true }
      }
    });
  } catch {
    const attempts = event.attempts + 1;
    const retryDelaySeconds = Math.min(30 * 2 ** Math.min(attempts, 8), 60 * 60);
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        attempts,
        availableAt: new Date(Date.now() + retryDelaySeconds * 1000),
        lastErrorRedacted: "smtp_delivery_failed"
      }
    });
  }
}

export async function dispatchPendingAuthEmails(limit = 20): Promise<number> {
  const events = await prisma.outboxEvent.findMany({
    where: {
      topic: { in: ["auth.email.send", "workspace.invitation.email.send"] },
      status: { in: ["PENDING", "FAILED"] },
      availableAt: { lte: new Date() },
      attempts: { lt: 10 }
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true }
  });

  for (const event of events) {
    await dispatchAuthEmailEvent(event.id);
  }

  return events.length;
}
