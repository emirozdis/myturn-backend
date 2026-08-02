"use client"

import * as React from "react"
import { EyeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type DetailDialogProps = {
  title: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
}

function DetailDialogContent({ title, description, children, actions }: DetailDialogProps) {
  return (
    <DialogContent className="admin-detail-dialog sm:max-w-[720px]">
      <DialogHeader className="admin-detail-header">
        <div className="admin-detail-eyebrow"><EyeIcon /> Record details</div>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <ScrollArea className="admin-detail-scroll">
        <div className="admin-detail-body">{children}</div>
      </ScrollArea>
      <DialogFooter className="admin-detail-footer">
        {actions ? <div className="admin-detail-footer-actions">{actions}</div> : null}
        <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  )
}

export function DetailDialogRow({
  title,
  description,
  details,
  actions,
  children,
  className,
}: DetailDialogProps & { details: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false)

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <>
      <tr
        className={cn("admin-clickable-row", className)}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      >
        {children}
      </tr>
      <Dialog open={open} onOpenChange={setOpen}>
        <DetailDialogContent title={title} description={description} actions={actions}>{details}</DetailDialogContent>
      </Dialog>
    </>
  )
}

export function DetailDialogCard({
  title,
  description,
  details,
  actions,
  children,
  className,
}: DetailDialogProps & { details: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false)

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <>
      <article
        className={cn("admin-clickable-card", className)}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      >
        {children}
      </article>
      <Dialog open={open} onOpenChange={setOpen}>
        <DetailDialogContent title={title} description={description} actions={actions}>{details}</DetailDialogContent>
      </Dialog>
    </>
  )
}

export function DetailGrid({ children }: { children: React.ReactNode }) {
  return <dl className="admin-detail-grid">{children}</dl>
}

export function DetailItem({ label, children, wide = false }: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return <div className={wide ? "admin-detail-item admin-detail-item-wide" : "admin-detail-item"}><dt>{label}</dt><dd>{children || "—"}</dd></div>
}

export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="admin-detail-section"><h3>{title}</h3>{children}</section>
}
