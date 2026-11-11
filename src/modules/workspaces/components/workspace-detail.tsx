"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Crown, LogOut, MailPlus, Save, ShieldCheck, Trash2, UserMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, SelectField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import { problemDetail } from "./workspace-list";
import styles from "./workspace-management.module.css";

interface WorkspaceDetailModel {
  readonly id: string;
  readonly kind: "PERSONAL" | "TEAM";
  readonly name: string;
  readonly slug: string | null;
  readonly ownerUserId: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface MemberModel {
  readonly id: string;
  readonly userId: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly joinedAt: Date;
  readonly version: number;
  readonly user: { readonly name: string; readonly email: string; readonly image: string | null };
}

interface InvitationModel {
  readonly id: string;
  readonly email: string;
  readonly role: "ADMIN" | "MEMBER";
  readonly status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly version: number;
}

interface Props {
  readonly workspace: WorkspaceDetailModel;
  readonly members: readonly MemberModel[];
  readonly invitations: readonly InvitationModel[];
  readonly currentUserId: string;
}

export function WorkspaceDetail({ workspace, members, invitations, currentUserId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canManageSettings = workspace.role === "OWNER" || workspace.role === "ADMIN";
  const canInvite = workspace.kind === "TEAM" && canManageSettings;

  async function mutate(key: string, input: RequestInfo | URL, init: RequestInit, success: string) {
    setPending(key);
    setMessage(null);
    const response = await fetch(input, init);
    if (!response.ok) setMessage(await problemDetail(response));
    else {
      setMessage(success);
      router.refresh();
    }
    setPending(null);
    return response.ok;
  }

  async function updateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      "workspace:update",
      `/api/v1/workspaces/${workspace.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"workspace:${workspace.id}:${workspace.version}"`
        },
        body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") || null })
      },
      "Workspace details updated."
    );
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await mutate(
      "invitation:create",
      `/api/v1/workspaces/${workspace.id}/invitations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role: form.get("role") })
      },
      "Invitation accepted for delivery."
    );
    if (ok) event.currentTarget.reset();
  }

  async function updateRole(member: MemberModel, role: "ADMIN" | "MEMBER") {
    await mutate(
      `role:${member.userId}`,
      `/api/v1/workspaces/${workspace.id}/members/${encodeURIComponent(member.userId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"workspace-member:${member.id}:${member.version}"`
        },
        body: JSON.stringify({ role })
      },
      `${member.user.name}'s role was updated.`
    );
  }

  async function remove(member: MemberModel) {
    const leaving = member.userId === currentUserId;
    if (
      !window.confirm(
        leaving ? `Leave ${workspace.name}?` : `Remove ${member.user.name} from ${workspace.name}?`
      )
    )
      return;
    const ok = await mutate(
      `remove:${member.userId}`,
      `/api/v1/workspaces/${workspace.id}/members/${encodeURIComponent(member.userId)}`,
      {
        method: "DELETE",
        headers: { "If-Match": `"workspace-member:${member.id}:${member.version}"` }
      },
      leaving ? "You left the workspace." : `${member.user.name} was removed.`
    );
    if (ok && leaving) router.push("/workspace");
  }

  async function transfer(member: MemberModel) {
    if (
      !window.confirm(
        `Transfer ownership of ${workspace.name} to ${member.user.name}? You will become an Admin.`
      )
    )
      return;
    await mutate(
      `transfer:${member.userId}`,
      `/api/v1/workspaces/${workspace.id}/ownership-transfers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: member.userId })
      },
      `Ownership transferred to ${member.user.name}.`
    );
  }

  async function revoke(invitation: InvitationModel) {
    await mutate(
      `revoke:${invitation.id}`,
      `/api/v1/workspaces/${workspace.id}/invitations/${invitation.id}`,
      {
        method: "DELETE",
        headers: { "If-Match": `"workspace-invitation:${invitation.id}:${invitation.version}"` }
      },
      "Invitation revoked."
    );
  }

  async function deleteWorkspace() {
    if (
      !window.confirm(
        `Schedule ${workspace.name} for deletion? It will become inaccessible immediately and remain recoverable for 30 days.`
      )
    )
      return;
    const ok = await mutate(
      "workspace:delete",
      `/api/v1/workspaces/${workspace.id}`,
      {
        method: "DELETE",
        headers: { "If-Match": `"workspace:${workspace.id}:${workspace.version}"` }
      },
      "Workspace scheduled for deletion."
    );
    if (ok) router.push("/workspace");
  }

  return (
    <div className={styles.detailStack}>
      {message ? (
        <p className={styles.formError} role="status">
          {message}
        </p>
      ) : null}

      <section className={styles.detailPanel} aria-labelledby="settings-title">
        <header>
          <div>
            <span className={styles.detailEyebrow}>Identity / version {workspace.version}</span>
            <h2 id="settings-title">Workspace settings</h2>
            <p>Names and slugs are visible only to current members in this release.</p>
          </div>
          <StatusPill tone={workspace.kind === "TEAM" ? "info" : "neutral"}>
            {workspace.kind}
          </StatusPill>
        </header>
        <form className={styles.inlineForm} onSubmit={updateWorkspace}>
          <FormField
            label="Workspace name"
            name="name"
            defaultValue={workspace.name}
            minLength={2}
            maxLength={120}
            disabled={!canManageSettings}
            required
          />
          <FormField
            label="Slug"
            name="slug"
            defaultValue={workspace.slug ?? ""}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            disabled={!canManageSettings}
            optional
          />
          {canManageSettings ? (
            <Button
              type="submit"
              loading={pending === "workspace:update"}
              leadingIcon={<Icon icon={Save} />}
            >
              Save
            </Button>
          ) : null}
        </form>
      </section>

      {canInvite ? (
        <section className={styles.detailPanel} aria-labelledby="invite-title">
          <header>
            <div>
              <span className={styles.detailEyebrow}>Collaboration / email invitation</span>
              <h2 id="invite-title">Invite a collaborator</h2>
              <p>Admins can invite Members. The Owner can also invite future Admins.</p>
            </div>
            <Icon icon={MailPlus} />
          </header>
          <form className={styles.inlineForm} onSubmit={invite}>
            <FormField
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <SelectField label="Initial role" name="role" defaultValue="MEMBER">
              <option value="MEMBER">Member</option>
              {workspace.role === "OWNER" ? <option value="ADMIN">Admin</option> : null}
            </SelectField>
            <Button
              type="submit"
              loading={pending === "invitation:create"}
              leadingIcon={<Icon icon={MailPlus} />}
            >
              Send invite
            </Button>
          </form>
          {invitations.length ? (
            <ul className={styles.invitationList} aria-label="Invitation history">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <span>
                      {invitation.role} · expires {formatDate(invitation.expiresAt)}
                    </span>
                  </div>
                  <StatusPill
                    tone={
                      invitation.status === "PENDING"
                        ? "warning"
                        : invitation.status === "ACCEPTED"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {invitation.status}
                  </StatusPill>
                  {invitation.status === "PENDING" &&
                  (workspace.role === "OWNER" || invitation.role === "MEMBER") ? (
                    <Button
                      variant="ghost"
                      size="small"
                      loading={pending === `revoke:${invitation.id}`}
                      onClick={() => revoke(invitation)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyInline}>No invitation history yet.</p>
          )}
        </section>
      ) : null}

      <section className={styles.detailPanel} aria-labelledby="members-title">
        <header>
          <div>
            <span className={styles.detailEyebrow}>Access register / {members.length} people</span>
            <h2 id="members-title">Members and roles</h2>
            <p>Every role change is authorized and recorded on the server.</p>
          </div>
          <Icon icon={ShieldCheck} />
        </header>
        <div className={styles.members}>
          {members.map((member) => {
            const canRemove =
              member.role !== "OWNER" &&
              (member.userId === currentUserId ||
                workspace.role === "OWNER" ||
                (workspace.role === "ADMIN" && member.role === "MEMBER"));
            return (
              <article className={styles.memberCard} key={member.id}>
                <div className={styles.memberHeader}>
                  <div className={styles.memberIdentity}>
                    <span className={styles.memberAvatar} aria-hidden="true">
                      {initials(member.user.name)}
                    </span>
                    <div>
                      <strong>
                        {member.user.name}
                        {member.userId === currentUserId ? " (you)" : ""}
                      </strong>
                      <span>
                        {member.user.email} · joined {formatDate(member.joinedAt)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.memberControls}>
                    {workspace.role === "OWNER" && member.role !== "OWNER" ? (
                      <SelectField
                        label="Role"
                        value={member.role}
                        disabled={pending === `role:${member.userId}`}
                        onChange={(event) =>
                          updateRole(member, event.currentTarget.value as "ADMIN" | "MEMBER")
                        }
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </SelectField>
                    ) : (
                      <StatusPill tone={member.role === "OWNER" ? "info" : "neutral"}>
                        {member.role}
                      </StatusPill>
                    )}
                    {workspace.role === "OWNER" && member.role !== "OWNER" ? (
                      <Button
                        variant="ghost"
                        size="small"
                        loading={pending === `transfer:${member.userId}`}
                        leadingIcon={<Icon icon={Crown} />}
                        onClick={() => transfer(member)}
                      >
                        Make owner
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        variant="ghost"
                        size="small"
                        loading={pending === `remove:${member.userId}`}
                        leadingIcon={
                          <Icon icon={member.userId === currentUserId ? LogOut : UserMinus} />
                        }
                        onClick={() => remove(member)}
                      >
                        {member.userId === currentUserId ? "Leave" : "Remove"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {workspace.kind === "TEAM" && workspace.role === "OWNER" ? (
        <section className={styles.dangerPanel} aria-labelledby="danger-title">
          <header>
            <div>
              <span className={styles.detailEyebrow}>Destructive controls</span>
              <h2 id="danger-title">Schedule workspace deletion</h2>
              <p>
                The workspace becomes inaccessible immediately, but the Owner can restore it during
                the 30-day recovery window. A recent sign-in is required.
              </p>
            </div>
          </header>
          <div className={styles.dangerActions}>
            <Button
              variant="danger"
              loading={pending === "workspace:delete"}
              leadingIcon={<Icon icon={Trash2} />}
              onClick={deleteWorkspace}
            >
              Schedule deletion
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "NX"
  );
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
