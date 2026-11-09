"use server";

import { revalidatePath } from "next/cache";
import { calculateDelayRisk, getDelayObservationWindow } from "@/lib/delay-risk";
import { canSubmitDelayAlertForRole, isDelayAlertFeatureEnabled, parseDelayAlertOrderId } from "@/lib/delay-alert-signing-core";
import { signDelayAlert } from "@/lib/delay-alert-signing";
import {
  decideDelayAlert,
  DELAY_ALERT_SNAPSHOT_FIELDS,
  DelayAlertDecisionSnapshot,
  DelayAlertDecisionStore,
} from "@/lib/delay-alert-decisions";
import { getProfile, requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type DelayAlertSubmissionResult =
  | { success: true; status: "recorded" }
  | { success: false; status: "disabled" | "invalid" | "error"; error: string };

/**
 * Recomputes the snapshot from RLS-scoped Supabase rows and signs it on the server.
 * The sole browser argument is the order UUID; no metrics or classifications cross the boundary.
 */
export async function submitDelayCandidate(orderIdInput: unknown): Promise<DelayAlertSubmissionResult> {
  const profile = await requireRole("merchandiser");
  if (!canSubmitDelayAlertForRole(profile.role)) {
    return { success: false, status: "invalid", error: "Only merchandisers can submit delay candidates." };
  }

  const orderId = parseDelayAlertOrderId(orderIdInput);
  if (!orderId) return { success: false, status: "invalid", error: "Select a valid production order." };

  // Explicit opt-in only. No RPC call occurs unless an operator deliberately enables it.
  if (!isDelayAlertFeatureEnabled(process.env.DELAY_ALERTS_ENABLED)) {
    return { success: false, status: "disabled", error: "Delay alert candidate submission is disabled." };
  }

  try {
    const supabase = await createClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, buyer_id, total_quantity, completed_quantity, final_production_stage, ex_factory_date")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      return { success: false, status: "error", error: "Could not load an accessible production order." };
    }
    if (typeof order.buyer_id !== "string" || !order.buyer_id) {
      return { success: false, status: "error", error: "The order has no valid buyer assignment." };
    }

    const updates: Array<{ stage: string; quantity_completed: number; update_date: string }> = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: page, error: updatesError } = await supabase
        .from("production_updates")
        .select("stage, quantity_completed, update_date")
        .eq("order_id", orderId)
        .order("update_date", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (updatesError || !page) {
        return { success: false, status: "error", error: "Could not load production history for this order." };
      }
      updates.push(...page);
      if (page.length < pageSize) break;
    }

    // Both Phase 1 and payload use this same instant; no client-supplied time is accepted.
    const calculatedAt = new Date();
    const risk = calculateDelayRisk({
      totalQuantity: order.total_quantity,
      completedQuantity: order.completed_quantity,
      finalProductionStage: order.final_production_stage,
      exFactoryDate: order.ex_factory_date,
    }, updates.map((update) => ({
      stage: update.stage,
      quantityCompleted: update.quantity_completed,
      updateDate: update.update_date,
    })), calculatedAt);
    const observationWindow = getDelayObservationWindow(calculatedAt);

    const signed = signDelayAlert({
      actorId: profile.id,
      orderId: order.id,
      buyerId: order.buyer_id,
      calculatedAt,
      totalQuantity: typeof order.total_quantity === "number" && Number.isSafeInteger(order.total_quantity)
        ? order.total_quantity : null,
      completedQuantity: typeof order.completed_quantity === "number" && Number.isSafeInteger(order.completed_quantity)
        ? order.completed_quantity : null,
      finalProductionStage: typeof order.final_production_stage === "string" ? order.final_production_stage : null,
      exFactoryDate: typeof order.ex_factory_date === "string" ? order.ex_factory_date : null,
      risk,
      observationWindowStart: observationWindow.start,
      observationWindowEnd: observationWindow.end,
    });

    // Payload and signature stay in this server action and are sent only to Supabase.
    const { error: rpcError } = await supabase.rpc("record_delay_candidate", {
      p_key_id: signed.keyId,
      p_payload: signed.payload,
      p_signature_hex: signed.signatureHex,
    });
    if (rpcError) {
      // Avoid forwarding database details that might echo signed request material.
      return { success: false, status: "error", error: "Supabase could not record the delay calculation." };
    }

    revalidatePath("/", "page");
    revalidatePath("/orders", "page");
    revalidatePath("/production-tracking", "page");
    return { success: true, status: "recorded" };
  } catch {
    // Do not log or return payload, signature, key bytes, or environment values.
    return { success: false, status: "error", error: "Delay candidate submission could not be completed." };
  }
}

export type DelayAlertDecisionActionResult = {
  status: "success" | "conflict" | "invalid" | "unauthorized" | "error";
  message: string;
};

function createDelayAlertDecisionStore(supabase: Awaited<ReturnType<typeof createClient>>): DelayAlertDecisionStore {
  return {
    async load(alertId) {
      const { data, error } = await supabase
        .from("delay_alerts")
        .select("approval_status, risk_level, calculated_at, calculation_version, total_quantity, completed_quantity, remaining_quantity, final_production_stage, ex_factory_date, observation_window_start, observation_window_end, history_date_count, observed_daily_output, required_daily_output, pace_ratio, days_remaining")
        .eq("id", alertId)
        .maybeSingle();
      if (error || !data) return { alert: null, error: Boolean(error) };
      const snapshot = Object.fromEntries(
        DELAY_ALERT_SNAPSHOT_FIELDS.map((field) => [field, data[field]]),
      ) as DelayAlertDecisionSnapshot;
      return { alert: { approval_status: data.approval_status, snapshot }, error: false };
    },

    async transition(alertId, snapshot, approvalStatus, dismissalReason) {
      const values = approvalStatus === "approved"
        ? { approval_status: "approved" as const }
        : { approval_status: "dismissed" as const, dismissal_reason: dismissalReason };
      let query = supabase
        .from("delay_alerts")
        .update(values)
        .eq("id", alertId)
        .eq("approval_status", "pending");

      for (const field of DELAY_ALERT_SNAPSHOT_FIELDS) {
        const value = snapshot[field];
        query = value === null ? query.is(field, null) : query.eq(field, value);
      }

      const { data, error } = await query.select("id").maybeSingle();
      return { updated: Boolean(data), error: Boolean(error) };
    },
  };
}

async function decidePendingAlert(
  alertId: unknown,
  displayedSnapshot: unknown,
  decision: "approved" | "dismissed",
  dismissalReason?: unknown,
): Promise<DelayAlertDecisionActionResult> {
  try {
    const profileResult = await getProfile();
    if (profileResult.status !== "authenticated") {
      return { status: "unauthorized", message: "Sign in with a valid KnitTrack profile to review alerts." };
    }
    if (profileResult.profile.role !== "merchandiser") {
      return { status: "unauthorized", message: "Only merchandisers can review delay alerts." };
    }

    const supabase = await createClient();
    const result = await decideDelayAlert({
      role: profileResult.profile.role,
      store: createDelayAlertDecisionStore(supabase),
      alertId,
      displayedSnapshot,
      decision,
      dismissalReason,
    });
    if (result.status === "success") {
      revalidatePath("/", "page");
      revalidatePath("/orders", "page");
    }
    return result;
  } catch {
    return { status: "error", message: "Could not save this decision. Please try again." };
  }
}

export async function approveDelayAlert(
  alertId: unknown,
  displayedSnapshot: unknown,
): Promise<DelayAlertDecisionActionResult> {
  return decidePendingAlert(alertId, displayedSnapshot, "approved");
}

export async function dismissDelayAlert(
  alertId: unknown,
  displayedSnapshot: unknown,
  dismissalReason: unknown,
): Promise<DelayAlertDecisionActionResult> {
  return decidePendingAlert(alertId, displayedSnapshot, "dismissed", dismissalReason);
}
