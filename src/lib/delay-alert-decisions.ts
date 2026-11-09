export const DELAY_ALERT_SNAPSHOT_FIELDS = [
  "risk_level",
  "calculated_at",
  "calculation_version",
  "total_quantity",
  "completed_quantity",
  "remaining_quantity",
  "final_production_stage",
  "ex_factory_date",
  "observation_window_start",
  "observation_window_end",
  "history_date_count",
  "observed_daily_output",
  "required_daily_output",
  "pace_ratio",
  "days_remaining",
] as const;

export type DelayAlertSnapshotField = (typeof DELAY_ALERT_SNAPSHOT_FIELDS)[number];
export type DelayAlertDecisionSnapshot = {
  risk_level: string;
  calculated_at: string;
  calculation_version: string;
  total_quantity: number | null;
  completed_quantity: number | null;
  remaining_quantity: number | null;
  final_production_stage: string | null;
  ex_factory_date: string | null;
  observation_window_start: string | null;
  observation_window_end: string | null;
  history_date_count: number;
  observed_daily_output: number | null;
  required_daily_output: number | null;
  pace_ratio: number | null;
  days_remaining: number | null;
};

export interface DelayAlertForReview {
  approval_status: string;
  snapshot: DelayAlertDecisionSnapshot;
}

export interface DelayAlertDecisionStore {
  load(alertId: string): Promise<{ alert: DelayAlertForReview | null; error: boolean }>;
  transition(
    alertId: string,
    snapshot: DelayAlertDecisionSnapshot,
    approvalStatus: "approved" | "dismissed",
    dismissalReason: string | null,
  ): Promise<{ updated: boolean; error: boolean }>;
}

export type DelayAlertDecisionResult =
  | { status: "success"; message: string }
  | { status: "conflict"; message: string }
  | { status: "invalid" | "unauthorized" | "error"; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONFLICT_MESSAGE = "This alert changed or was already reviewed. Refresh the page and review the latest calculation.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function snapshotMatches(current: DelayAlertDecisionSnapshot, displayed: unknown): boolean {
  if (!isRecord(displayed)) return false;
  return DELAY_ALERT_SNAPSHOT_FIELDS.every((field) =>
    Object.hasOwn(displayed, field) && Object.is(current[field], displayed[field]),
  );
}

function normalizeDismissalReason(value: unknown): { valid: boolean; reason: string | null } {
  if (value === undefined || value === null) return { valid: true, reason: null };
  if (typeof value !== "string") return { valid: false, reason: null };
  const reason = value.trim();
  // PostgreSQL char_length counts characters, so count Unicode code points here.
  if (Array.from(reason).length > 2000) return { valid: false, reason: null };
  return { valid: true, reason: reason || null };
}

export async function decideDelayAlert(input: {
  role: unknown;
  store: DelayAlertDecisionStore;
  alertId: unknown;
  displayedSnapshot: unknown;
  decision: "approved" | "dismissed";
  dismissalReason?: unknown;
}): Promise<DelayAlertDecisionResult> {
  if (input.role !== "merchandiser") {
    return { status: "unauthorized", message: "Only merchandisers can review delay alerts." };
  }
  if (!isCanonicalUuid(input.alertId)) {
    return { status: "invalid", message: "The alert reference is invalid. Refresh the page and try again." };
  }

  const dismissal = input.decision === "dismissed"
    ? normalizeDismissalReason(input.dismissalReason)
    : { valid: true, reason: null };
  if (!dismissal.valid) {
    return { status: "invalid", message: "Dismissal reason must be 2,000 characters or fewer." };
  }

  try {
    const { alert, error: loadError } = await input.store.load(input.alertId);
    if (loadError) return { status: "error", message: "Could not load this alert. Please try again." };
    if (!alert || alert.approval_status !== "pending" ||
        !snapshotMatches(alert.snapshot, input.displayedSnapshot)) {
      return { status: "conflict", message: CONFLICT_MESSAGE };
    }

    const { updated, error } = await input.store.transition(
      input.alertId,
      alert.snapshot,
      input.decision,
      dismissal.reason,
    );
    if (error) return { status: "error", message: "Could not save this decision. Please try again." };
    if (!updated) return { status: "conflict", message: CONFLICT_MESSAGE };

    return {
      status: "success",
      message: input.decision === "approved" ? "Delay alert approved." : "Delay alert dismissed.",
    };
  } catch {
    return { status: "error", message: "Could not save this decision. Please try again." };
  }
}
