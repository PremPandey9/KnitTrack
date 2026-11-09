import { createHmac } from "node:crypto";
import type { DelayRiskResult, DelayRiskStatus } from "@/lib/delay-risk";

export const DELAY_ALERT_KEY_ID = "v1";
export const DELAY_ALERT_CALCULATION_VERSION = "phase1-v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RISK_STATUSES: readonly DelayRiskStatus[] = [
  "Complete", "Overdue", "High Risk", "At Risk", "Watch", "On Track", "Review Needed",
];
const CANDIDATE_STATUSES: readonly DelayRiskStatus[] = ["Overdue", "High Risk", "At Risk", "Watch"];

export interface DelayAlertSnapshot {
  requestId: string;
  actorId: string;
  orderId: string;
  buyerId: string;
  calculatedAt: Date;
  totalQuantity: number | null;
  completedQuantity: number | null;
  finalProductionStage: string | null;
  exFactoryDate: string | null;
  risk: DelayRiskResult;
  observationWindowStart: string | null;
  observationWindowEnd: string | null;
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

/** Server Action input is deliberately a single UUID string, never a snapshot object. */
export function parseDelayAlertOrderId(input: unknown): string | null {
  return isCanonicalUuid(input) ? input : null;
}

export function canSubmitDelayAlertForRole(role: unknown): boolean {
  return role === "merchandiser";
}

export function isDelayAlertFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function isDelayAlertCandidateStatus(status: DelayRiskStatus): boolean {
  return CANDIDATE_STATUSES.includes(status);
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}

function nullableInteger(value: number | null, label: string): string {
  if (value === null) return "~";
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer or null.`);
  return String(value);
}

function nullableRate(value: number | null, label: string): string {
  if (value === null) return "~";
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite or null.`);
  // Number#toString is the canonical shortest round-trip decimal accepted by PostgreSQL numeric.
  return Object.is(value, -0) ? "0" : value.toString();
}

function encodeFinalStage(value: string | null): string {
  return value === null ? "~" : Buffer.from(value, "utf8").toString("base64url");
}

/** Builds the SQL RPC's exact 21-line UTF-8 payload. It contains no trailing LF. */
export function buildDelayAlertPayload(snapshot: DelayAlertSnapshot): string {
  const { risk, calculatedAt } = snapshot;
  if (!isCanonicalUuid(snapshot.requestId) || !isCanonicalUuid(snapshot.actorId) ||
      !isCanonicalUuid(snapshot.orderId) || !isCanonicalUuid(snapshot.buyerId)) {
    throw new Error("Delay alert payload contains a non-canonical UUID.");
  }
  if (!(calculatedAt instanceof Date) || Number.isNaN(calculatedAt.getTime())) {
    throw new Error("Delay alert calculation timestamp is invalid.");
  }
  if (!RISK_STATUSES.includes(risk.status)) throw new Error("Delay alert risk classification is invalid.");
  if (!Number.isSafeInteger(risk.historyDates) || risk.historyDates < 0) {
    throw new Error("History date count must be a non-negative integer.");
  }
  if (snapshot.finalProductionStage !== null && typeof snapshot.finalProductionStage !== "string") {
    throw new Error("Final production stage must be text or null.");
  }
  if (snapshot.observationWindowStart !== null) assertDate(snapshot.observationWindowStart, "Observation window start");
  if (snapshot.observationWindowEnd !== null) assertDate(snapshot.observationWindowEnd, "Observation window end");
  if (snapshot.exFactoryDate !== null) assertDate(snapshot.exFactoryDate, "Ex-factory date");

  const lines = [
    "knittrack-delay-v1",
    `key_id=${DELAY_ALERT_KEY_ID}`,
    `request_id=${snapshot.requestId}`,
    `actor_id=${snapshot.actorId}`,
    `order_id=${snapshot.orderId}`,
    `buyer_id=${snapshot.buyerId}`,
    `risk_level=${risk.status}`,
    `calculated_at=${calculatedAt.toISOString()}`,
    `calculation_version=${DELAY_ALERT_CALCULATION_VERSION}`,
    `total_quantity=${nullableInteger(snapshot.totalQuantity, "Total quantity")}`,
    `completed_quantity=${nullableInteger(snapshot.completedQuantity, "Completed quantity")}`,
    `remaining_quantity=${nullableInteger(risk.remainingQuantity, "Remaining quantity")}`,
    `final_production_stage_b64url=${encodeFinalStage(snapshot.finalProductionStage)}`,
    `ex_factory_date=${snapshot.exFactoryDate ?? "~"}`,
    `observation_window_start=${snapshot.observationWindowStart ?? "~"}`,
    `observation_window_end=${snapshot.observationWindowEnd ?? "~"}`,
    `history_date_count=${risk.historyDates}`,
    `observed_daily_output=${nullableRate(risk.observedDailyOutput, "Observed daily output")}`,
    `required_daily_output=${nullableRate(risk.requiredDailyOutput, "Required daily output")}`,
    `pace_ratio=${nullableRate(risk.paceRatio, "Pace ratio")}`,
    `days_remaining=${nullableInteger(risk.daysRemaining, "Days remaining")}`,
  ];
  return lines.join("\n");
}

/** The environment value is hex text representing the exact key bytes stored in SQL. */
export function decodeDelayAlertSigningKey(secret: string | undefined): Buffer {
  if (!secret) throw new Error("Delay alert signing is enabled but its server key is not configured.");
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(secret) || secret.length < 64) {
    throw new Error("The delay alert signing key must be hexadecimal and at least 32 bytes.");
  }
  return Buffer.from(secret, "hex");
}

/** HMACs the exact UTF-8 bytes, returning lowercase hexadecimal for the SQL RPC. */
export function signDelayAlertPayload(payload: string, key: Buffer): string {
  if (payload.includes("\r") || payload.endsWith("\n")) {
    throw new Error("Delay alert payload must use LF separators and have no trailing newline.");
  }
  return createHmac("sha256", key).update(Buffer.from(payload, "utf8")).digest("hex");
}
