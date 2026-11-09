export type DelayRiskStatus =
  | "Complete"
  | "Overdue"
  | "High Risk"
  | "At Risk"
  | "Watch"
  | "On Track"
  | "Review Needed";

export interface DelayOrderInput {
  totalQuantity: unknown;
  completedQuantity: unknown;
  finalProductionStage: unknown;
  exFactoryDate: unknown;
}

export interface DelayProductionUpdateInput {
  stage: unknown;
  quantityCompleted: unknown;
  updateDate: unknown;
}

export interface DelayRiskResult {
  status: DelayRiskStatus;
  remainingQuantity: number | null;
  daysRemaining: number | null;
  observedDailyOutput: number | null;
  requiredDailyOutput: number | null;
  paceRatio: number | null;
  historyDates: number;
  reason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OBSERVATION_DAYS = 14;
const TIME_ZONE = "Asia/Kolkata";

/**
 * Round the canonical decimal representation of a JS number the same way as
 * PostgreSQL round(numeric, scale): ties away from zero. The payload signer
 * sends Number#toString() for numeric values, so this is the exact decimal
 * PostgreSQL parses. Using Number#toFixed() here can disagree at half steps
 * because it rounds the underlying binary float instead.
 */
export function roundCanonicalDecimalToScaledInteger(value: number, scale: number): bigint {
  if (!Number.isFinite(value) || !Number.isInteger(scale) || scale < 0) {
    throw new Error("A finite value and non-negative integer scale are required.");
  }

  const valueText = value.toString().toLowerCase();
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(valueText);
  if (!match) throw new Error("Number could not be represented as a canonical decimal.");

  const [, sign, integerPart, fractionalPart = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  const digits = BigInt(`${integerPart}${fractionalPart}` || "0");
  const shift = scale - fractionalPart.length + exponent;
  let rounded: bigint;

  if (shift >= 0) {
    rounded = digits * (BigInt(10) ** BigInt(shift));
  } else {
    const divisor = BigInt(10) ** BigInt(-shift);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    rounded = quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0));
  }

  return sign === "-" ? -rounded : rounded;
}

/** Returns the exact inclusive calendar window used by the Phase 1 calculation. */
export function getDelayObservationWindow(now: Date): {
  start: string;
  end: string;
} {
  const end = factoryDate(now);
  return {
    start: new Date((dayNumber(end) - (OBSERVATION_DAYS - 1)) * DAY_MS)
      .toISOString()
      .slice(0, 10),
    end,
  };
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return value;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function factoryDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function review(reason: string, remainingQuantity: number | null = null, daysRemaining: number | null = null, historyDates = 0): DelayRiskResult {
  return { status: "Review Needed", remainingQuantity, daysRemaining, observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null, historyDates, reason };
}

/** Pure Phase 1 delay calculation. Dates are interpreted as calendar dates in the factory timezone. */
export function calculateDelayRisk(
  order: DelayOrderInput,
  updates: DelayProductionUpdateInput[],
  now: Date = new Date(),
): DelayRiskResult {
  const total = order.totalQuantity;
  const completed = order.completedQuantity;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total <= 0 ||
      typeof completed !== "number" || !Number.isSafeInteger(completed) || completed < 0 || completed > total) {
    return review("Order quantities are missing or invalid.");
  }

  const today = factoryDate(now);
  const observationWindow = getDelayObservationWindow(now);
  const dueDate = parseDate(order.exFactoryDate);
  if (!dueDate) return review("Ex-factory date is missing or invalid.");
  const daysUntilDue = dayNumber(dueDate) - dayNumber(today) + 1;
  const remainingQuantity = Math.max(0, total - completed);
  if (remainingQuantity === 0) {
    return { status: "Complete", remainingQuantity: 0, daysRemaining: Math.max(0, daysUntilDue), observedDailyOutput: null, requiredDailyOutput: 0, paceRatio: null, historyDates: 0, reason: null };
  }

  const daysRemaining = daysUntilDue;
  const normalizedFinalStage = typeof order.finalProductionStage === "string" ? order.finalProductionStage.trim().toLocaleLowerCase("en-US") : "";
  if (!normalizedFinalStage) return review("Final production stage is not configured.", remainingQuantity, daysRemaining);
  if (daysRemaining < 1) return { status: "Overdue", remainingQuantity, daysRemaining: 0, observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null, historyDates: 0, reason: "Ex-factory date has passed." };

  const todayNumber = dayNumber(today);
  const firstWindowDay = dayNumber(observationWindow.start);
  const outputByDate = new Map<string, number>();
  for (const update of updates) {
    const updateStage = typeof update.stage === "string" ? update.stage.trim().toLocaleLowerCase("en-US") : "";
    const date = parseDate(update.updateDate);
    const quantity = update.quantityCompleted;
    if (updateStage !== normalizedFinalStage || !date || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    const updateDay = dayNumber(date);
    if (updateDay < firstWindowDay || updateDay > todayNumber) continue;
    outputByDate.set(date, (outputByDate.get(date) || 0) + quantity);
  }

  const outputDates = [...outputByDate.keys()].sort();
  const span = outputDates.length > 1 ? dayNumber(outputDates[outputDates.length - 1]) - dayNumber(outputDates[0]) : 0;
  if (outputDates.length < 5 || span < 7) {
    return review("At least five final-stage production dates spanning seven calendar days are required.", remainingQuantity, daysRemaining, outputDates.length);
  }

  const observedDailyOutput = [...outputByDate.values()].reduce((sum, value) => sum + value, 0) / OBSERVATION_DAYS;
  const requiredDailyOutput = remainingQuantity / daysRemaining;
  const paceRatio = observedDailyOutput / requiredDailyOutput;
  const comparisonRatio = roundCanonicalDecimalToScaledInteger(paceRatio, 10);
  let status: DelayRiskStatus;
  if (comparisonRatio < BigInt("8000000000")) status = "High Risk";
  else if (comparisonRatio < BigInt("10000000000")) status = "At Risk";
  else if (comparisonRatio < BigInt("11000000000")) status = "Watch";
  else status = "On Track";
  return { status, remainingQuantity, daysRemaining, observedDailyOutput, requiredDailyOutput, paceRatio, historyDates: outputDates.length, reason: null };
}

export function delayRiskTone(status: DelayRiskStatus): "green" | "amber" | "red" | "neutral" {
  if (status === "Complete" || status === "On Track") return "green";
  if (status === "Watch" || status === "At Risk") return "amber";
  if (status === "High Risk" || status === "Overdue") return "red";
  return "neutral";
}
