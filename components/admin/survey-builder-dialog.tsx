"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { createSurvey, updateSurvey, type SurveyActionState } from "@/app/admin/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

type QuestionType = "FREE_TEXT" | "SINGLE_SELECT" | "MULTI_SELECT"
type BuilderOption = { id: string; labelEn: string; labelTr: string }
type BuilderQuestion = {
  key: string
  type: QuestionType
  promptEn: string
  promptTr: string
  descriptionEn: string
  descriptionTr: string
  isRequired: boolean
  minLength: number
  maxLength: number
  minSelected: number
  maxSelected: number
  options: BuilderOption[]
}

export type SurveyEditorValue = {
  id: string
  key: string
  revision: number
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED"
  titleEn: string
  titleTr: string
  descriptionEn: string
  descriptionTr: string
  isMandatory: boolean
  priority: number
  platforms: string[]
  releaseChannels: string[]
  appVersions: string[]
  buildNumbers: number[]
  minAppVersion: string
  maxAppVersion: string
  minBuildNumber: number | null
  maxBuildNumber: number | null
  startsAt: string
  endsAt: string
  audience: string
  presentation: string
  metadata: string
  questions: BuilderQuestion[]
}

const initialState: SurveyActionState = {}

function emptyQuestion(index: number): BuilderQuestion {
  return {
    key: `question_${index + 1}`,
    type: "FREE_TEXT",
    promptEn: "",
    promptTr: "",
    descriptionEn: "",
    descriptionTr: "",
    isRequired: true,
    minLength: 0,
    maxLength: 1000,
    minSelected: 1,
    maxSelected: 2,
    options: [
      { id: "option_1", labelEn: "", labelTr: "" },
      { id: "option_2", labelEn: "", labelTr: "" },
    ],
  }
}

export function SurveyBuilderDialog({ survey }: { survey?: SurveyEditorValue }) {
  const editing = Boolean(survey)
  const [open, setOpen] = React.useState(false)
  const [questions, setQuestions] = React.useState<BuilderQuestion[]>(survey?.questions ?? [emptyQuestion(0)])
  const [state, formAction, pending] = React.useActionState(editing ? updateSurvey : createSurvey, initialState)

  function updateQuestion(index: number, patch: Partial<BuilderQuestion>) {
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question))
  }

  function updateOption(questionIndex: number, optionIndex: number, patch: Partial<BuilderOption>) {
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === questionIndex
      ? { ...question, options: question.options.map((option, index) => index === optionIndex ? { ...option, ...patch } : option) }
      : question))
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) setQuestions(survey?.questions ?? [emptyQuestion(0)])
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild><Button type="button" size={editing ? "sm" : "lg"} variant={editing ? "outline" : "default"}>{editing ? <PencilIcon /> : <PlusIcon />}{editing ? "Edit survey" : "New survey"}</Button></DialogTrigger>
      <DialogContent className="survey-builder-dialog sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit survey" : "Create survey"}</DialogTitle>
          <DialogDescription>{editing ? `Update ${survey?.key}. Question changes preserve submitted responses and may create a new revision.` : "Build the survey, targeting rules, and localized question set in one place."}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="survey-builder-form">
          {survey ? <input type="hidden" name="surveyId" value={survey.id} /> : null}
          <input type="hidden" name="questions" value={JSON.stringify(questions)} />
          <ScrollArea className="survey-builder-scroll">
            <div className="survey-builder-content">
              {state.error ? <div className="admin-form-alert" role="alert">{state.error}</div> : null}
              <section className="survey-builder-section">
                <div className="survey-builder-section-heading"><span>01</span><div><h3>Survey basics</h3><p>Internal identity, lifecycle, and localized copy.</p></div></div>
                <div className="survey-form-grid">
                  <label>Survey key<input className="admin-form-input" name="key" required pattern="[a-z0-9][a-z0-9_-]{2,99}" defaultValue={survey?.key} placeholder="onboarding_quality_2026_08" /></label>
                  <label>Status<select className="admin-form-input" name="status" defaultValue={survey?.status ?? "DRAFT"}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="ARCHIVED">Archived</option></select></label>
                  <label>English title<input className="admin-form-input" name="titleEn" required defaultValue={survey?.titleEn} placeholder="Help shape MyTurn" /></label>
                  <label>Turkish title<input className="admin-form-input" name="titleTr" defaultValue={survey?.titleTr} placeholder="MyTurn’u birlikte geliştirelim" /></label>
                  <label className="survey-form-wide">English description<textarea className="admin-form-input" name="descriptionEn" rows={2} defaultValue={survey?.descriptionEn} /></label>
                  <label className="survey-form-wide">Turkish description<textarea className="admin-form-input" name="descriptionTr" rows={2} defaultValue={survey?.descriptionTr} /></label>
                  <label>Priority<input className="admin-form-input" name="priority" type="number" defaultValue={survey?.priority ?? 0} /></label>
                  <label className="survey-checkbox"><input name="isMandatory" type="checkbox" defaultChecked={survey?.isMandatory} /><span><strong>Mandatory survey</strong><small>Ignores the user’s optional survey preference.</small></span></label>
                </div>
              </section>
              <Separator />
              <section className="survey-builder-section">
                <div className="survey-builder-section-heading"><span>02</span><div><h3>Targeting & schedule</h3><p>Leave lists empty to include everyone.</p></div></div>
                <div className="survey-form-grid">
                  <label>Platforms<input className="admin-form-input" name="platforms" defaultValue={survey?.platforms.join(", ")} placeholder="ios, android" /></label>
                  <label>Release channels<input className="admin-form-input" name="releaseChannels" defaultValue={survey?.releaseChannels.join(", ")} placeholder="production, preview" /></label>
                  <label>Exact app versions<input className="admin-form-input" name="appVersions" defaultValue={survey?.appVersions.join(", ")} placeholder="1.2.0, 1.2.1" /></label>
                  <label>Exact build numbers<input className="admin-form-input" name="buildNumbers" defaultValue={survey?.buildNumbers.join(", ")} placeholder="100, 101" /></label>
                  <div className="survey-inline-fields"><label>Minimum version<input className="admin-form-input" name="minAppVersion" defaultValue={survey?.minAppVersion} placeholder="1.0.0" /></label><label>Maximum version<input className="admin-form-input" name="maxAppVersion" defaultValue={survey?.maxAppVersion} placeholder="2.0.0" /></label></div>
                  <div className="survey-inline-fields"><label>Minimum build<input className="admin-form-input" name="minBuildNumber" type="number" min="0" defaultValue={survey?.minBuildNumber ?? undefined} /></label><label>Maximum build<input className="admin-form-input" name="maxBuildNumber" type="number" min="0" defaultValue={survey?.maxBuildNumber ?? undefined} /></label></div>
                  <div className="survey-inline-fields"><label>Starts at (UTC)<input className="admin-form-input" name="startsAt" type="datetime-local" defaultValue={survey?.startsAt} /></label><label>Ends at (UTC)<input className="admin-form-input" name="endsAt" type="datetime-local" defaultValue={survey?.endsAt} /></label></div>
                </div>
              </section>
              <Separator />
              <section className="survey-builder-section">
                <div className="survey-builder-section-heading"><span>03</span><div><h3>Questions</h3><p>{editing ? `Currently revision ${survey?.revision}. Changes are versioned after responses exist.` : "Questions are saved in this order as revision 1."}</p></div><Button type="button" variant="outline" onClick={() => setQuestions((current) => [...current, emptyQuestion(current.length)])}><PlusIcon /> Add question</Button></div>
                <div className="survey-question-list">
                  {questions.map((question, questionIndex) => (
                    <article className="survey-question-editor" key={questionIndex}>
                      <header><span>Question {questionIndex + 1}</span>{questions.length > 1 ? <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove question ${questionIndex + 1}`} onClick={() => setQuestions((current) => current.filter((_, index) => index !== questionIndex))}><Trash2Icon /></Button> : null}</header>
                      <div className="survey-form-grid">
                        <label>Question key<input className="admin-form-input" value={question.key} onChange={(event) => updateQuestion(questionIndex, { key: event.target.value })} /></label>
                        <label>Type<select className="admin-form-input" value={question.type} onChange={(event) => updateQuestion(questionIndex, { type: event.target.value as QuestionType })}><option value="FREE_TEXT">Free text</option><option value="SINGLE_SELECT">Single select</option><option value="MULTI_SELECT">Multi select</option></select></label>
                        <label>English prompt<input className="admin-form-input" value={question.promptEn} onChange={(event) => updateQuestion(questionIndex, { promptEn: event.target.value })} required /></label>
                        <label>Turkish prompt<input className="admin-form-input" value={question.promptTr} onChange={(event) => updateQuestion(questionIndex, { promptTr: event.target.value })} /></label>
                        <label>English helper text<input className="admin-form-input" value={question.descriptionEn} onChange={(event) => updateQuestion(questionIndex, { descriptionEn: event.target.value })} /></label>
                        <label>Turkish helper text<input className="admin-form-input" value={question.descriptionTr} onChange={(event) => updateQuestion(questionIndex, { descriptionTr: event.target.value })} /></label>
                        {question.type === "FREE_TEXT" ? <div className="survey-inline-fields"><label>Minimum length<input className="admin-form-input" type="number" min="0" max="10000" value={question.minLength} onChange={(event) => updateQuestion(questionIndex, { minLength: Number(event.target.value) })} /></label><label>Maximum length<input className="admin-form-input" type="number" min="1" max="10000" value={question.maxLength} onChange={(event) => updateQuestion(questionIndex, { maxLength: Number(event.target.value) })} /></label></div> : null}
                        {question.type === "MULTI_SELECT" ? <div className="survey-inline-fields"><label>Minimum choices<input className="admin-form-input" type="number" min="0" value={question.minSelected} onChange={(event) => updateQuestion(questionIndex, { minSelected: Number(event.target.value) })} /></label><label>Maximum choices<input className="admin-form-input" type="number" min="1" value={question.maxSelected} onChange={(event) => updateQuestion(questionIndex, { maxSelected: Number(event.target.value) })} /></label></div> : null}
                        <label className="survey-checkbox"><input type="checkbox" checked={question.isRequired} onChange={(event) => updateQuestion(questionIndex, { isRequired: event.target.checked })} /><span><strong>Required</strong><small>User must answer before submitting.</small></span></label>
                      </div>
                      {question.type !== "FREE_TEXT" ? <div className="survey-options-editor"><div className="survey-options-heading"><strong>Answer options</strong><Button type="button" variant="outline" size="sm" onClick={() => updateQuestion(questionIndex, { options: [...question.options, { id: `option_${question.options.length + 1}`, labelEn: "", labelTr: "" }] })}><PlusIcon /> Add option</Button></div>{question.options.map((option, optionIndex) => <div className="survey-option-row" key={optionIndex}><input className="admin-form-input" aria-label="Option ID" placeholder="stable_id" value={option.id} onChange={(event) => updateOption(questionIndex, optionIndex, { id: event.target.value })} /><input className="admin-form-input" aria-label="English option label" placeholder="English label" value={option.labelEn} onChange={(event) => updateOption(questionIndex, optionIndex, { labelEn: event.target.value })} /><input className="admin-form-input" aria-label="Turkish option label" placeholder="Turkish label" value={option.labelTr} onChange={(event) => updateOption(questionIndex, optionIndex, { labelTr: event.target.value })} />{question.options.length > 2 ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => updateQuestion(questionIndex, { options: question.options.filter((_, index) => index !== optionIndex) })}><Trash2Icon /></Button> : null}</div>)}</div> : null}
                    </article>
                  ))}
                </div>
              </section>
              <Separator />
              <section className="survey-builder-section">
                <div className="survey-builder-section-heading"><span>04</span><div><h3>Advanced configuration</h3><p>Optional JSON objects for audience, presentation, and internal metadata.</p></div></div>
                <div className="survey-form-grid">
                  <label className="survey-form-wide">Audience rules<textarea className="admin-form-input admin-json-input" name="audience" rows={5} defaultValue={survey?.audience} placeholder={'{"locales":["en","tr"],"rolloutPercentage":25}'} /></label>
                  <label className="survey-form-wide">Presentation<textarea className="admin-form-input admin-json-input" name="presentation" rows={5} defaultValue={survey?.presentation} placeholder={'{"accentColor":"#D9FF66","snoozeHours":24}'} /></label>
                  <label className="survey-form-wide">Metadata<textarea className="admin-form-input admin-json-input" name="metadata" rows={4} defaultValue={survey?.metadata} placeholder={'{"owner":"research"}'} /></label>
                </div>
              </section>
            </div>
          </ScrollArea>
          <DialogFooter className="survey-builder-footer"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save changes" : "Create survey"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
