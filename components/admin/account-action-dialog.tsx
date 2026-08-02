"use client";

import * as React from "react";
import { LogOutIcon, SnowflakeIcon, Trash2Icon, UnlockIcon } from "lucide-react";
import { useFormStatus } from "react-dom";

import { manageUserAccount } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type AccountOperation = "freeze" | "unfreeze" | "revoke_sessions" | "delete";

const actionCopy: Record<AccountOperation, {
  label: string;
  title: string;
  description: (name: string) => string;
  confirmLabel: string;
}> = {
  freeze: {
    label: "Freeze account",
    title: "Freeze this account?",
    description: (name) => `${name} will immediately lose access. Active sessions will be revoked, but account data will be preserved.`,
    confirmLabel: "Confirm freeze",
  },
  unfreeze: {
    label: "Unfreeze account",
    title: "Restore this account?",
    description: (name) => `${name} will be allowed to sign in and use the app again.`,
    confirmLabel: "Confirm unfreeze",
  },
  revoke_sessions: {
    label: "Sign out all devices",
    title: "Sign out every device?",
    description: (name) => `${name}'s refresh tokens will be revoked. They can sign in again unless the account is frozen.`,
    confirmLabel: "Confirm sign out",
  },
  delete: {
    label: "Delete account",
    title: "Permanently delete this account?",
    description: (name) => `${name}'s identity, profile, vlogs, responses, managed media, and related account data will be deleted. This cannot be undone.`,
    confirmLabel: "Permanently delete",
  },
};

function SubmitAction({ operation, enabled }: { operation: AccountOperation; enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={operation === "delete" ? "destructive" : "default"} disabled={!enabled || pending}>
      {pending ? "Working…" : actionCopy[operation].confirmLabel}
    </Button>
  );
}

export function AccountActionDialog({
  operation,
  userId,
  userName,
  userEmail,
}: {
  operation: AccountOperation;
  userId: string;
  userName: string;
  userEmail: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [typedConfirmation, setTypedConfirmation] = React.useState("");
  const [reason, setReason] = React.useState("");
  const copy = actionCopy[operation];
  const isDelete = operation === "delete";
  const enabled = isDelete
    ? typedConfirmation === "DELETE"
    : acknowledged && (operation !== "freeze" || reason.trim().length > 0);

  const Icon = operation === "delete"
    ? Trash2Icon
    : operation === "revoke_sessions"
      ? LogOutIcon
      : operation === "unfreeze"
        ? UnlockIcon
        : SnowflakeIcon;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setAcknowledged(false);
      setTypedConfirmation("");
      setReason("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={isDelete ? "admin-secondary-danger" : undefined}>
          <Icon />{copy.label}
        </Button>
      </DialogTrigger>
      <DialogContent className="admin-confirm-dialog sm:max-w-[500px]">
        <DialogHeader>
          <div className="admin-confirm-icon"><Icon /></div>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description(userName)}</DialogDescription>
        </DialogHeader>
        <form action={manageUserAccount} className="admin-confirm-form">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="operation" value={operation} />
          <input type="hidden" name="confirmation" value={isDelete ? typedConfirmation : acknowledged ? "CONFIRM" : ""} />

          {operation === "freeze" ? (
            <label className="admin-confirm-field">
              <span>Reason for freezing</span>
              <textarea name="reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the audit log" required />
            </label>
          ) : null}

          {isDelete ? (
            <label className="admin-confirm-field">
              <span>Type <strong>DELETE</strong> to confirm deletion of {userEmail}</span>
              <input value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          ) : (
            <label className="admin-confirm-check">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              <span>I understand the immediate effect of this action.</span>
            </label>
          )}

          <DialogFooter className="admin-confirm-footer">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <SubmitAction operation={operation} enabled={enabled} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
