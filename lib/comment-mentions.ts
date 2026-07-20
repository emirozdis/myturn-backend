export type MentionableUser = {
  id: string;
  handle: string | null;
};

const TRAILING_SENTENCE_PUNCTUATION = /[.,!?;:)\]}]$/u;
const MENTION_TOKEN = /(?:^|[^\p{L}\p{N}_@])@([^\s@]+)/gu;

/**
 * Resolves typed mention tokens against the members of the comment's group.
 * Exact tokens win before sentence punctuation is removed, so handles such as
 * `sam.dev` are not accidentally treated as `sam`.
 */
export function findMentionedUserIds(
  text: string,
  members: MentionableUser[],
): string[] {
  const membersByHandle = new Map(
    members
      .filter((member): member is MentionableUser & { handle: string } => Boolean(member.handle))
      .map((member) => [member.handle.toLowerCase(), member.id]),
  );
  const mentionedIds = new Set<string>();

  for (const match of text.matchAll(MENTION_TOKEN)) {
    let candidate = match[1].toLowerCase();

    while (candidate) {
      const userId = membersByHandle.get(candidate);
      if (userId) {
        mentionedIds.add(userId);
        break;
      }

      if (!TRAILING_SENTENCE_PUNCTUATION.test(candidate)) break;
      candidate = candidate.slice(0, -1);
    }
  }

  return [...mentionedIds];
}
