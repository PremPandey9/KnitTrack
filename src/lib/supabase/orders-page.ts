import "server-only";

import { createClient } from "@/lib/supabase/server";
import { UserProfile } from "@/lib/supabase/auth";
import { formatDeliveryDate } from "@/lib/supabase/orders";
import { calculateDelayRisk, delayRiskTone, DelayRiskResult, DelayRiskStatus } from "@/lib/delay-risk";

export interface OrdersPageItem {
  id: string;
  poNumber: string;
  buyer: string;
  style: string;
  colour: string;
  totalQuantity: number;
  completedQuantity: number;
  stage: string;
  exFactoryDate: string;
  supervisor: string;
  deliveryStatus: "green" | "amber" | "red" | "neutral";
  deliveryStatusLabel: DelayRiskStatus;
  delayRisk?: DelayRiskResult;
}

export interface OrdersPageResult {
  orders: OrdersPageItem[];
  error: { code?: string; message: string } | null;
  riskError: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function buyerLabel(row: Record<string, unknown>, buyersById: Map<string, string>) {
  const relation = asRecord(row.buyers);
  const name = relation?.company_name ||
    row.buyer_name || row.client || row.company;
  if (name) return String(name);
  const buyerId = String(row.buyer_id || "");
  return buyersById.get(buyerId) || "Buyer unavailable";
}

/** Reads using the current user's cookie-bound Supabase client, so RLS remains active. */
export async function getOrdersPageData(profile: UserProfile): Promise<OrdersPageResult> {
  try {
    const supabase = await createClient();
    const buyerScope = profile.role === "buyer" ? profile.buyerId : null;
    if (profile.role === "buyer" && !buyerScope) {
      return { orders: [], error: { message: "Your profile is missing its buyer assignment." }, riskError: null };
    }

    let query = supabase
      .from("orders")
      .select("*, buyers(*)")
      .order("created_at", { ascending: false });
    if (buyerScope) query = query.eq("buyer_id", buyerScope);

    let { data, error } = await query;
    let rows = (data || []) as Array<Record<string, unknown>>;

    // Preserve compatibility with databases where the orders-to-buyers FK is not exposed.
    if (error && /relationship|foreign/i.test(error.message)) {
      let fallback = supabase.from("orders").select("*").order("created_at", { ascending: false });
      if (buyerScope) fallback = fallback.eq("buyer_id", buyerScope);
      const fallbackResult = await fallback;
      data = fallbackResult.data;
      error = fallbackResult.error;
      rows = (data || []) as Array<Record<string, unknown>>;
    }

    if (error) return { orders: [], error: { code: error.code, message: error.message }, riskError: null };

    const buyerIds = [...new Set(rows.map((row) => String(row.buyer_id || "")).filter(Boolean))];
    const buyersById = new Map<string, string>();
    if (buyerIds.length) {
      const { data: buyers, error: buyersError } = await supabase
        .from("buyers")
        .select("*")
        .in("id", buyerIds);
      if (buyersError) return { orders: [], error: { code: buyersError.code, message: buyersError.message }, riskError: null };
      for (const buyer of buyers || []) {
        const row = buyer as Record<string, unknown>;
        buyersById.set(String(row.id), String(row.company_name || "Buyer"));
      }
    }

    const supervisorIds = [...new Set(rows.map((row) =>
      String(row.assigned_supervisor_id || row.supervisor_id || "")
    ).filter(Boolean))];
    const supervisorsById = new Map<string, string>();
    if (supervisorIds.length) {
      // This lookup also runs under the user's RLS policies. Names are optional if the
      // current role is not allowed to read the referenced profiles.
      const { data: supervisors } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", supervisorIds);
      for (const supervisor of supervisors || []) {
        const row = supervisor as Record<string, unknown>;
        supervisorsById.set(String(row.id), String(row.full_name || ""));
      }
    }

    let riskError: string | null = null;
    const updatesByOrder = new Map<string, Array<{ stage: unknown; quantityCompleted: number; updateDate: unknown }>>();
    if (profile.role === "merchandiser" && rows.length) {
      const orderIds = rows.map((row) => String(row.id || "")).filter(Boolean);
      const { data: updates, error: updatesError } = await supabase
        .from("production_updates")
        .select("order_id, stage, quantity_completed, update_date")
        .in("order_id", orderIds);
      if (updatesError) riskError = updatesError.message;
      else for (const update of updates || []) {
        const key = String(update.order_id);
        const list = updatesByOrder.get(key) || [];
        list.push({ stage: update.stage, quantityCompleted: Number(update.quantity_completed), updateDate: update.update_date });
        updatesByOrder.set(key, list);
      }
    }

    return {
      orders: rows.map((row, index) => {
        const delayRisk = profile.role === "merchandiser"
          ? riskError
            ? { status: "Review Needed" as const, remainingQuantity: null, daysRemaining: null, observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null, historyDates: 0, reason: "Production history could not be loaded." }
            : calculateDelayRisk({
              totalQuantity: row.total_quantity,
              completedQuantity: row.completed_quantity,
              finalProductionStage: row.final_production_stage,
              exFactoryDate: row.ex_factory_date,
            }, updatesByOrder.get(String(row.id || "")) || [])
          : undefined;
        const status = delayRisk ? delayRiskTone(delayRisk.status) : "neutral";
        const label: DelayRiskStatus = delayRisk?.status || "Review Needed";
        const supervisorRelation = asRecord(row.assigned_supervisor) || asRecord(row.supervisor);
        const supervisorId = String(row.assigned_supervisor_id || row.supervisor_id || "");
        const supervisorName = row.assigned_supervisor_name || row.supervisor_name ||
          supervisorRelation?.full_name || supervisorRelation?.name ||
          supervisorsById.get(supervisorId) || "";

        return {
          id: String(row.id || `order-${index}`),
          poNumber: String(row.po_number || row.order_number || "—"),
          buyer: buyerLabel(row, buyersById),
          style: String(row.style_name || row.style || row.garment_style || "—"),
          colour: String(row.colour || row.color || "—"),
          totalQuantity: Number(row.total_quantity ?? row.order_quantity ?? row.quantity ?? 0),
          completedQuantity: Number(row.completed_quantity ?? row.produced_quantity ?? row.completed_units ?? 0),
          stage: String(row.current_stage || row.stage || "—"),
          exFactoryDate: formatDeliveryDate(String(row.ex_factory_date || "")),
          supervisor: String(supervisorName || "—"),
          deliveryStatus: status,
          deliveryStatusLabel: label,
          delayRisk,
        };
      }),
      error: null,
      riskError,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not load orders.";
    return { orders: [], error: { message }, riskError: null };
  }
}
