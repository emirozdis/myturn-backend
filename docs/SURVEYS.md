# Database-managed surveys

Surveys are authored directly in PostgreSQL for now. The mobile app only receives the highest-priority active survey that matches the signed-in user and the current app build.

## Data model

- `surveys` controls lifecycle, targeting, scheduling, priority, mandatory behavior, and presentation.
- `survey_questions` contains ordered free-text, single-select, or multi-select questions.
- `survey_responses` records one submission per user and survey revision.
- `survey_answers` stores the submitted JSON value plus prompt and option snapshots.
- `profiles.allowOptionalSurveys` is user-controlled. It never suppresses a mandatory survey.

Create a survey as `DRAFT`, add and verify every question, then set it to `ACTIVE`. Set it to `PAUSED` to stop delivery without deleting it. Surveys and questions referenced by responses should not be deleted.

## Example survey

Run this as one transaction. Empty targeting arrays mean “all.”

```sql
BEGIN;

WITH new_survey AS (
  INSERT INTO surveys (
    key,
    revision,
    status,
    title,
    description,
    "isMandatory",
    priority,
    platforms,
    "releaseChannels",
    "minAppVersion",
    "minBuildNumber",
    "startsAt",
    audience,
    presentation
  )
  VALUES (
    'onboarding_quality_2026_08',
    1,
    'DRAFT',
    '{"en":"Help shape MyTurn","tr":"MyTurn’u birlikte geliştirelim"}'::jsonb,
    '{"en":"Two quick questions about your first week.","tr":"İlk haftan hakkında iki kısa soru."}'::jsonb,
    false,
    100,
    ARRAY['ios','android'],
    ARRAY['production'],
    '1.0.0',
    19,
    now(),
    '{
      "locales": ["en", "tr"],
      "minAccountAgeDays": 7,
      "maxAccountAgeDays": 30,
      "hasAnyGroup": true,
      "rolloutPercentage": 25,
      "rolloutSeed": "onboarding-quality-v1"
    }'::jsonb,
    '{
      "accentColor": "#D9FF66",
      "delayMs": 1200,
      "snoozeHours": 24,
      "submitLabel": "Send feedback"
    }'::jsonb
  )
  RETURNING id
)
INSERT INTO survey_questions (
  "surveyId", "surveyRevision", key, type, prompt, description, options,
  "isRequired", "sortOrder", "minLength", "maxLength",
  "minSelected", "maxSelected"
)
SELECT id, 1, 'experience', 'SINGLE_SELECT',
  '{"en":"How has your first week felt?","tr":"İlk haftan nasıl geçti?"}'::jsonb,
  NULL,
  '[
    {"id":"great","label":{"en":"Great","tr":"Harika"}},
    {"id":"okay","label":{"en":"Okay","tr":"İyi"}},
    {"id":"difficult","label":{"en":"Difficult","tr":"Zor"}}
  ]'::jsonb,
  true, 1, NULL, NULL, 1, 1
FROM new_survey
UNION ALL
SELECT id, 1, 'improvement', 'FREE_TEXT',
  '{"en":"What should we improve next?","tr":"Sırada neyi iyileştirmeliyiz?"}'::jsonb,
  '{"en":"Share as much or as little as you like.","tr":"İstediğin kadar ayrıntı paylaşabilirsin."}'::jsonb,
  NULL,
  false, 2, 0, 1000, NULL, NULL
FROM new_survey;

UPDATE surveys
SET status = 'ACTIVE', "updatedAt" = now()
WHERE key = 'onboarding_quality_2026_08';

COMMIT;
```

## Targeting reference

Technical columns:

- `platforms`: any of `ios`, `android`, `web`
- `releaseChannels`: any of `development`, `preview`, `production`
- `appVersions`: exact allowlist
- `minAppVersion`, `maxAppVersion`: inclusive dotted-version range
- `buildNumbers`: exact allowlist
- `minBuildNumber`, `maxBuildNumber`: inclusive numeric range
- `startsAt`, `endsAt`: UTC delivery window
- `priority`: higher is delivered first; mandatory surveys are always considered before optional ones

The `audience` JSON object supports:

- `includeUserIds`, `excludeUserIds`
- `locales`
- `emailDomains`
- `createdAfter`, `createdBefore` as ISO timestamps
- `minAccountAgeDays`, `maxAccountAgeDays`
- `hasAnyGroup`
- `groupIds` (membership in any listed group)
- `minGroupCount`, `maxGroupCount`
- `rolloutPercentage` from 0 through 100 and an optional stable `rolloutSeed`

All supplied rules are combined with AND. Arrays within one rule use OR. Unknown keys are ignored, so add new targeting behavior to the server before relying on a new key.

The `presentation` JSON object supports `accentColor` as a six-digit hex color, `delayMs` up to 15 seconds, optional-survey `snoozeHours` up to 30 days, `submitLabel`, `successTitle`, and `successBody`. The three text fields may use the same localized JSON format as survey copy.

## Question rules

- `FREE_TEXT`: use `minLength` and `maxLength` (server maximum: 10,000).
- `SINGLE_SELECT`: `options` must be an array of stable IDs and localized labels.
- `MULTI_SELECT`: use `minSelected` and `maxSelected`.
- `prompt`, `description`, survey `title`, and survey `description` accept `{"en":"…","tr":"…"}`. English is the fallback.

Use stable option IDs; labels can change without changing analysis values.

## Relaunching a survey

Once a user submits revision 1, it will not appear again. To intentionally ask the survey again, insert a new question set using `survey_questions.surveyRevision = 2`, then increment `surveys.revision` to 2 after the new set is complete. Do not update or delete old question rows. Existing responses retain their original question relationships, prompts, and option snapshots.

## Reading results

Summary:

```sql
SELECT
  s.key,
  r."surveyRevision",
  count(DISTINCT r.id) AS responses,
  min(r."submittedAt") AS first_response,
  max(r."submittedAt") AS latest_response
FROM survey_responses r
JOIN surveys s ON s.id = r."surveyId"
GROUP BY s.key, r."surveyRevision"
ORDER BY latest_response DESC;
```

Answer export:

```sql
SELECT
  s.key AS survey_key,
  r."surveyRevision" AS revision,
  r."userId" AS user_id,
  r.platform,
  r."appVersion" AS app_version,
  r."buildNumber" AS build_number,
  r."submittedAt" AS submitted_at,
  a."questionKey" AS question_key,
  a."promptSnapshot" AS prompt,
  a."optionsSnapshot" AS options,
  a.value
FROM survey_answers a
JOIN survey_responses r ON r.id = a."responseId"
JOIN surveys s ON s.id = r."surveyId"
ORDER BY r."submittedAt" DESC, a."questionKey";
```
