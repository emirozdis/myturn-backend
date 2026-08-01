export function getRaincheckUserId(
  yesterdayAssignment: { passedByUserId: string | null } | null | undefined,
  currentMemberIds: ReadonlySet<string>,
): string | null {
  const passedByUserId = yesterdayAssignment?.passedByUserId;
  return passedByUserId && currentMemberIds.has(passedByUserId) ? passedByUserId : null;
}
