-- Clips reference the prompt catalog rather than duplicating prompt text.
ALTER TABLE "clips" ADD COLUMN "promptId" TEXT;

-- Preserve existing associations for both canonical and translated prompt text.
UPDATE "clips" AS clip
SET "promptId" = (
  SELECT prompt.id
  FROM "prompts" AS prompt
  WHERE prompt.text = clip.prompt
     OR EXISTS (
       SELECT 1
       FROM jsonb_each_text(COALESCE(prompt.translations, '{}'::jsonb)) AS translation
       WHERE translation.value = clip.prompt
  )
  ORDER BY (prompt.text = clip.prompt) DESC, prompt.id
  LIMIT 1
)
WHERE clip.prompt IS NOT NULL;

ALTER TABLE "clips" DROP COLUMN "prompt";

CREATE INDEX "clips_promptId_idx" ON "clips"("promptId");

ALTER TABLE "clips"
ADD CONSTRAINT "clips_promptId_fkey"
FOREIGN KEY ("promptId") REFERENCES "prompts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
