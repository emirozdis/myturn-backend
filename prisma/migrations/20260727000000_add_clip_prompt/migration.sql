-- A prompt describes an individual clip, not the daily assignment as a whole.
ALTER TABLE "clips" ADD COLUMN "prompt" TEXT;
