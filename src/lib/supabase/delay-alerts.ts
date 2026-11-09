import "server-only";

import { createClient } from "@/lib/supabase/server";
import { DelayAlertDecisionSnapshot } from "@/lib/delay-alert-decisions";

export interface DelayAlertReviewItem {
  id: string;
  snapshot: DelayAlertDecisionSnapshot;
  poNumber: string;
  styleName: string;
  buyerCompany: string;
}

export interface DelayAlertReviewQueue {
  alerts: DelayAlertReviewItem[];
  error: string | null;
}

/** Loads only pending alerts through the authenticated, RLS-bound server client. */
export async function getPendingDelayAlertReviewQueue(): Promise<DelayAlertReviewQueue> {
  try {
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("delay_alerts")
      .select("id, order_id, buyer_id, risk_level, calculated_at, calculation_version, total_quantity, completed_quantity, remaining_quantity, final_production_stage, ex_factory_date, observation_window_start, observation_window_end, history_date_count, observed_daily_output, required_daily_output, pace_ratio, days_remaining")
      .eq("approval_status", "pending")
      .order("calculated_at", { ascending: false });

    if (error) return { alerts: [], error: "Pending delay alerts could not be loaded." };
    if (!rows?.length) return { alerts: [], error: null };

    const orderIds = [...new Set(rows.map((row) => row.order_id).filter((id): id is string => typeof id === "string"))];
    const buyerIds = [...new Set(rows.map((row) => row.buyer_id).filter((id): id is string => typeof id === "string"))];
    const [orderResult, buyerResult] = await Promise.all([
      orderIds.length
        ? supabase.from("orders").select("id, po_number, style_name").in("id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      buyerIds.length
        ? supabase.from("buyers").select("id, company_name").in("id", buyerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (orderResult.error || buyerResult.error) {
      return { alerts: [], error: "Order or buyer details for pending alerts could not be loaded." };
    }

    const orders = new Map((orderResult.data || []).map((order) => [order.id, order]));
    const buyers = new Map((buyerResult.data || []).map((buyer) => [buyer.id, buyer]));
    const alerts: DelayAlertReviewItem[] = rows.map((row) => ({
      id: row.id,
      snapshot: {
        risk_level: row.risk_level,
        calculated_at: row.calculated_at,
        calculation_version: row.calculation_version,
        total_quantity: row.total_quantity,
        completed_quantity: row.completed_quantity,
        remaining_quantity: row.remaining_quantity,
        final_production_stage: row.final_production_stage,
        ex_factory_date: row.ex_factory_date,
        observation_window_start: row.observation_window_start,
        observation_window_end: row.observation_window_end,
        history_date_count: row.history_date_count,
        observed_daily_output: row.observed_daily_output,
        required_daily_output: row.required_daily_output,
        pace_ratio: row.pace_ratio,
        days_remaining: row.days_remaining,
      },
      poNumber: orders.get(row.order_id)?.po_number || "Production order",
      styleName: orders.get(row.order_id)?.style_name || "Style not provided",
      buyerCompany: buyers.get(row.buyer_id)?.company_name || "Buyer",
    }));

    return { alerts, error: null };
  } catch {
    return { alerts: [], error: "Pending delay alerts could not be loaded." };
  }
}
