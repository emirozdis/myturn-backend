"use client";

import * as React from "react";
import { Trash2Icon } from "lucide-react";
import { useFormStatus } from "react-dom";

import { deleteSurvey } from "@/app/admin/actions";
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

function DeleteButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="destructive" disabled={!enabled || pending}>{pending ? "Deleting…" : "Permanently delete"}</Button>;
}

export function SurveyDeleteDialog({
  surveyId,
  surveyKey,
  responseCount,
}: {
  surveyId: string;
  surveyKey: string;
  responseCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setConfirmation("");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="admin-secondary-danger"><Trash2Icon />Delete survey</Button>
      </DialogTrigger>
      <DialogContent className="admin-confirm-dialog sm:max-w-[500px]">
        <DialogHeader>
          <div className="admin-confirm-icon"><Trash2Icon /></div>
          <DialogTitle>Permanently delete this survey?</DialogTitle>
          <DialogDescription>
            The survey, every question, and {responseCount === 0 ? "its response history" : responseCount === 1 ? "its one submitted response" : `all ${responseCount} submitted responses`} will be deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form action={deleteSurvey} className="admin-confirm-form">
          <input type="hidden" name="surveyId" value={surveyId} />
          <input type="hidden" name="confirmation" value={confirmation} />
          <label className="admin-confirm-field">
            <span>Type <strong>{surveyKey}</strong> to confirm</span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <DialogFooter className="admin-confirm-footer">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <DeleteButton enabled={confirmation === surveyKey} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
