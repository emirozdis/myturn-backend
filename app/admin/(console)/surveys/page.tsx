import { PageHeader, EmptyState } from "@/app/admin/_components/admin-shell";
import { getSurveys } from "@/lib/admin-data";
import { formatDate, jsonText } from "@/lib/admin-format";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DetailDialogCard, DetailGrid, DetailItem, DetailSection } from "@/components/admin/detail-dialog";
import { SurveyBuilderDialog, type SurveyEditorValue } from "@/components/admin/survey-builder-dialog";
import { SurveyDeleteDialog } from "@/components/admin/survey-delete-dialog";

export const dynamic = "force-dynamic";

function answerText(value: unknown, optionsSnapshot: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const options = Array.isArray(optionsSnapshot) ? optionsSnapshot : [];
  return values.map((item) => {
    const option = options.find((candidate) => candidate && typeof candidate === "object" && "id" in candidate && candidate.id === item) as { label?: unknown } | undefined;
    if (option?.label) return jsonText(option.label);
    if (typeof item === "string") return item;
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    return JSON.stringify(item);
  }).join(", ");
}

function localizedFields(value: unknown) {
  if (typeof value === "string") return { en: value, tr: "" };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { en: typeof record.en === "string" ? record.en : "", tr: typeof record.tr === "string" ? record.tr : "" };
  }
  return { en: "", tr: "" };
}

function jsonObjectText(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value, null, 2) : "";
}

function dateInputValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

type AdminSurvey = Awaited<ReturnType<typeof getSurveys>>[number];

function surveyEditorValue(survey: AdminSurvey): SurveyEditorValue {
  const title = localizedFields(survey.title);
  const description = localizedFields(survey.description);
  return {
    id: survey.id,
    key: survey.key,
    revision: survey.revision,
    status: survey.status,
    titleEn: title.en,
    titleTr: title.tr,
    descriptionEn: description.en,
    descriptionTr: description.tr,
    isMandatory: survey.isMandatory,
    priority: survey.priority,
    platforms: survey.platforms,
    releaseChannels: survey.releaseChannels,
    appVersions: survey.appVersions,
    buildNumbers: survey.buildNumbers,
    minAppVersion: survey.minAppVersion ?? "",
    maxAppVersion: survey.maxAppVersion ?? "",
    minBuildNumber: survey.minBuildNumber,
    maxBuildNumber: survey.maxBuildNumber,
    startsAt: dateInputValue(survey.startsAt),
    endsAt: dateInputValue(survey.endsAt),
    audience: jsonObjectText(survey.audience),
    presentation: jsonObjectText(survey.presentation),
    metadata: jsonObjectText(survey.metadata),
    questions: survey.questions.filter((question) => question.surveyRevision === survey.revision).map((question) => {
      const prompt = localizedFields(question.prompt);
      const helper = localizedFields(question.description);
      return {
        key: question.key,
        type: question.type,
        promptEn: prompt.en,
        promptTr: prompt.tr,
        descriptionEn: helper.en,
        descriptionTr: helper.tr,
        isRequired: question.isRequired,
        minLength: question.minLength ?? 0,
        maxLength: question.maxLength ?? 1000,
        minSelected: question.minSelected ?? 1,
        maxSelected: question.maxSelected ?? 1,
        options: Array.isArray(question.options) ? question.options.map((value) => {
          const option = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
          const label = localizedFields(option.label);
          return { id: typeof option.id === "string" ? option.id : "", labelEn: label.en, labelTr: label.tr };
        }) : [],
      };
    }),
  };
}

export default async function AdminSurveysPage() {
  const surveys = await getSurveys();
  return (
    <>
      <PageHeader eyebrow="Research" title="Surveys" description="Create surveys, inspect every question, and review each user’s submitted answers." action={<SurveyBuilderDialog />} />
      <section className="survey-grid">
        {surveys.length ? surveys.map((survey) => (
          <DetailDialogCard
            className="admin-panel survey-card"
            key={survey.id}
            title={jsonText(survey.title)}
            description={`Survey key: ${survey.key}`}
            actions={<><SurveyBuilderDialog key={`edit-${survey.id}-${survey.updatedAt.toISOString()}`} survey={surveyEditorValue(survey)} /><SurveyDeleteDialog surveyId={survey.id} surveyKey={survey.key} responseCount={survey._count.responses} /></>}
            details={<>
              <div className="admin-detail-status-line"><Badge variant="outline">{survey.status}</Badge><span>Revision {survey.revision}</span></div>
              <DetailSection title="Overview"><DetailGrid>
                <DetailItem label="Survey ID">{survey.id}</DetailItem><DetailItem label="Key">{survey.key}</DetailItem>
                <DetailItem label="Priority">{survey.priority}</DetailItem><DetailItem label="Mandatory">{survey.isMandatory ? "Yes" : "No"}</DetailItem>
                <DetailItem label="Questions">{survey._count.questions}</DetailItem><DetailItem label="Responses">{survey._count.responses}</DetailItem>
                <DetailItem label="Starts">{formatDate(survey.startsAt)}</DetailItem><DetailItem label="Ends">{formatDate(survey.endsAt)}</DetailItem>
                <DetailItem label="Description" wide>{jsonText(survey.description) === "Untitled" ? "No description provided." : jsonText(survey.description)}</DetailItem>
              </DetailGrid></DetailSection>
              <Separator />
              <DetailSection title="Targeting"><DetailGrid>
                <DetailItem label="Platforms">{survey.platforms.join(", ") || "All"}</DetailItem><DetailItem label="Release channels">{survey.releaseChannels.join(", ") || "All"}</DetailItem>
                <DetailItem label="App versions">{survey.appVersions.join(", ") || "All"}</DetailItem><DetailItem label="Build numbers">{survey.buildNumbers.join(", ") || "All"}</DetailItem>
                <DetailItem label="Minimum version">{survey.minAppVersion || "Any"}</DetailItem><DetailItem label="Maximum version">{survey.maxAppVersion || "Any"}</DetailItem>
                <DetailItem label="Minimum build">{survey.minBuildNumber ?? "Any"}</DetailItem><DetailItem label="Maximum build">{survey.maxBuildNumber ?? "Any"}</DetailItem>
              </DetailGrid></DetailSection>
              <Separator />
              <DetailSection title={`Questions (${survey.questions.length})`}>
                <div className="survey-detail-question-list">{survey.questions.map((question) => (
                  <article key={question.id} className="survey-detail-question">
                    <header><div><strong>{jsonText(question.prompt)}</strong><span>{question.key} · Revision {question.surveyRevision}</span></div><Badge variant="outline">{question.type.replace("_", " ")}</Badge></header>
                    {question.description ? <p>{jsonText(question.description)}</p> : null}
                    <div className="survey-question-rules"><span>{question.isRequired ? "Required" : "Optional"}</span>{question.minLength !== null ? <span>Min {question.minLength} characters</span> : null}{question.maxLength !== null ? <span>Max {question.maxLength} characters</span> : null}{question.minSelected !== null ? <span>Choose at least {question.minSelected}</span> : null}{question.maxSelected !== null ? <span>Choose up to {question.maxSelected}</span> : null}</div>
                    {Array.isArray(question.options) ? <ul>{question.options.map((option, index) => <li key={index}>{option && typeof option === "object" && "label" in option ? jsonText(option.label) : JSON.stringify(option)}</li>)}</ul> : null}
                  </article>
                ))}</div>
              </DetailSection>
              <Separator />
              <DetailSection title={`User responses (${survey.responses.length})`}>
                {survey.responses.length ? <div className="survey-response-list">{survey.responses.map((response) => (
                  <article className="survey-response-card" key={response.id}>
                    <header><div className="feedback-author"><span>{response.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{response.user.name}</strong><small>{response.user.handle ? `@${response.user.handle}` : response.user.email}</small></div></div><div><strong>{formatDate(response.submittedAt)}</strong><small>{response.platform} · v{response.appVersion}{response.buildNumber !== null ? ` (${response.buildNumber})` : ""}</small></div></header>
                    <dl>{response.answers.map((answer) => <div key={answer.id}><dt>{jsonText(answer.promptSnapshot)}</dt><dd>{answerText(answer.value, answer.optionsSnapshot)}</dd></div>)}</dl>
                    {response.clientContext ? <details><summary>Client context</summary><pre className="admin-detail-code">{JSON.stringify(response.clientContext, null, 2)}</pre></details> : null}
                  </article>
                ))}</div> : <div className="admin-empty compact">No users have submitted this survey yet.</div>}
              </DetailSection>
              {survey.audience ? <DetailSection title="Audience rules"><pre className="admin-detail-code">{JSON.stringify(survey.audience, null, 2)}</pre></DetailSection> : null}
              {survey.presentation ? <DetailSection title="Presentation"><pre className="admin-detail-code">{JSON.stringify(survey.presentation, null, 2)}</pre></DetailSection> : null}
              {survey.metadata ? <DetailSection title="Metadata"><pre className="admin-detail-code">{JSON.stringify(survey.metadata, null, 2)}</pre></DetailSection> : null}
            </>}
          >
            <div className="survey-card-top"><span className={`survey-status survey-${survey.status.toLowerCase()}`}>{survey.status}</span><span>Revision {survey.revision}</span></div>
            <h2>{jsonText(survey.title)}</h2><p>{jsonText(survey.description) === "Untitled" ? "No description provided." : jsonText(survey.description)}</p>
            <div className="survey-metrics"><div><strong>{survey._count.responses}</strong><span>Responses</span></div><div><strong>{survey._count.questions}</strong><span>Questions</span></div><div><strong>{survey.isMandatory ? "Yes" : "No"}</strong><span>Mandatory</span></div></div>
            <dl><div><dt>Starts</dt><dd>{formatDate(survey.startsAt)}</dd></div><div><dt>Ends</dt><dd>{formatDate(survey.endsAt)}</dd></div><div><dt>Platforms</dt><dd>{survey.platforms.join(", ") || "All"}</dd></div><div><dt>Versions</dt><dd>{survey.minAppVersion || "Any"}{survey.maxAppVersion ? ` – ${survey.maxAppVersion}` : "+"}</dd></div></dl>
            <span className="card-view-label">Open details →</span>
          </DetailDialogCard>
        )) : <EmptyState>No surveys have been created.</EmptyState>}
      </section>
    </>
  );
}
