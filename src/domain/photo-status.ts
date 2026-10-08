export const PHOTO_STATUSES = ["queued", "analyzing", "analyzed", "failed"] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

/**
 * Every legal status change lives here. The repository turns each event into a
 * conditional UPDATE (`WHERE status IN from`), so a racing or replayed job
 * cannot move a photo along an edge that is not listed.
 */
export const PHOTO_EVENTS = {
  claim: { from: ["queued", "analyzing"], to: "analyzing" },
  succeed: { from: ["analyzing"], to: "analyzed" },
  failAttempt: { from: ["analyzing"], to: "queued" },
  failFinal: { from: ["analyzing"], to: "failed" },
  retry: { from: ["failed"], to: "queued" },
} as const satisfies Record<string, { from: readonly PhotoStatus[]; to: PhotoStatus }>;

export type PhotoEvent = keyof typeof PHOTO_EVENTS;

export function isTerminal(status: PhotoStatus): boolean {
  return status === "analyzed" || status === "failed";
}
