CREATE TABLE "comment_likes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comment_likes_commentId_userId_key"
ON "comment_likes"("commentId", "userId");

CREATE INDEX "comment_likes_userId_createdAt_idx"
ON "comment_likes"("userId", "createdAt");

ALTER TABLE "comment_likes"
ADD CONSTRAINT "comment_likes_commentId_fkey"
FOREIGN KEY ("commentId") REFERENCES "comments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comment_likes"
ADD CONSTRAINT "comment_likes_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
