import { createClient } from "@/lib/supabase/server";
import { OrderItem, MetricSummary, DeadlineItem, Buyer } from "@/types/dashboard";
import { UserProfile } from "@/lib/supabase/auth";
import { calculateDelayRisk, delayRiskTone, DelayRiskResult } from "@/lib/delay-risk";

export interface DashboardFetchResult {
  orders: OrderItem[];
  metrics: MetricSummary;
  deadlines: DeadlineItem[];
  buyers: Buyer[];
  riskError: string | null;
  error: {
    code?: string;
    message: string;
    hint?: string | null;
  } | null;
}

/**
 * Formats database date strings (e.g. "2026-11-20") into readable text (e.g. "November 20, 2026").
 * Parses year, month, and day directly for "YYYY-MM-DD" dates to prevent UTC-to-local timezone regression.
 */
export function formatDeliveryDate(dateStr?: string | null): string {
  if (!dateStr) return "TBD";
  try {
    const dateMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    let d: Date;
    if (dateMatch) {
      const year = parseInt(dateMatch[1], 10);
      const monthIndex = parseInt(dateMatch[2], 10) - 1;
      const day = parseInt(dateMatch[3], 10);
      d = new Date(year, monthIndex, day);
    } else {
      d = new Date(dateStr);
    }

    if (isNaN(d.getTime())) return dateStr;

    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Server-side function to fetch orders and associated buyer details from Supabase.
 * Calculates metrics directly from actual database rows.
 */
export async function getDashboardData(profile: UserProfile): Promise<DashboardFetchResult> {
  try {
    const supabase = await createClient();

    // Query orders from Supabase
    // First attempt: relational join with buyers table
    let rawOrders: Array<Record<string, unknown>> = [];
    let fetchError: { code?: string; message: string; hint?: string | null } | null = null;

    let baseOrderQuery = supabase
      .from("orders")
      .select("*, buyers(*)")
      .order("created_at", { ascending: false });
    if (profile.role === "buyer" && profile.buyerId) {
      baseOrderQuery = baseOrderQuery.eq("buyer_id", profile.buyerId);
    }
    const joinQuery = await baseOrderQuery;

    if (!joinQuery.error && joinQuery.data) {
      rawOrders = joinQuery.data as Array<Record<string, unknown>>;
    } else if (joinQuery.error) {
      // If error is relationship-related, try querying orders and buyers separately
      if (joinQuery.error.message.includes("relationship") || joinQuery.error.message.includes("foreign")) {
        let fallbackOrdersQuery = supabase.from("orders").select("*").order("created_at", { ascending: false });
        if (profile.role === "buyer" && profile.buyerId) {
          fallbackOrdersQuery = fallbackOrdersQuery.eq("buyer_id", profile.buyerId);
        }
        const [ordersRes, buyersRes] = await Promise.all([
          fallbackOrdersQuery,
          profile.role === "merchandiser"
            ? supabase.from("buyers").select("*")
            : profile.role === "buyer" && profile.buyerId
              ? supabase.from("buyers").select("*").eq("id", profile.buyerId)
              : Promise.resolve({ data: [], error: null }),
        ]);

        if (ordersRes.error) {
          fetchError = {
            code: ordersRes.error.code,
            message: ordersRes.error.message,
            hint: ordersRes.error.hint,
          };
        } else {
          const buyersMap = new Map<string, string>();
          if (buyersRes.data) {
            for (const b of buyersRes.data as Array<Record<string, unknown>>) {
              const bId = String(b.id);
              const bName = String(b.company_name || "Company");
              buyersMap.set(bId, bName);
            }
          }

          rawOrders = (ordersRes.data || []).map((row: Record<string, unknown>) => {
            const buyerId = String(row.buyer_id || "");
            const resolvedBuyer = buyersMap.get(buyerId) || String(row.client || row.buyer || "Company");
            return {
              ...row,
              buyers: { name: resolvedBuyer },
            };
          });
        }
      } else {
        // Permission denied (42501) or other database errors
        fetchError = {
          code: joinQuery.error.code,
          message: joinQuery.error.message,
          hint: joinQuery.error.hint,
        };
      }
    }

    if (fetchError) {
      return {
        orders: [],
        metrics: {
          totalOrders: 0,
          onTrack: 0,
          atRisk: 0,
          delayed: 0,
          weeklyTargetPcs: 0,
          weeklyActualPcs: 0,
        },
        deadlines: [],
        buyers: [],
        riskError: null,
        error: fetchError,
      };
    }

    // Always fetch all buyers from Supabase to populate buyer dropdown (Requirement 2)
    const buyersRes = profile.role === "merchandiser"
      ? await supabase.from("buyers").select("*").order("company_name", { ascending: true })
      : profile.role === "buyer" && profile.buyerId
        ? await supabase.from("buyers").select("*").eq("id", profile.buyerId)
        : { data: [], error: null };

    const buyersList: Buyer[] = (buyersRes.data || []).map((b: Record<string, unknown>) => ({
      id: String(b.id),
      name: String(b.company_name || "Company"),
    }));

    // Production update quantities are stage throughput. The calculation helper
    // counts only final-stage output and leaves finished-goods totals untouched.
    let riskError: string | null = null;
    let updatesByOrder = new Map<string, Array<{ stage: unknown; quantityCompleted: unknown; updateDate: unknown }>>();
    if (profile.role === "merchandiser" && rawOrders.length) {
      const orderIds = rawOrders.map((row) => String(row.id || "")).filter(Boolean);
      const { data: updateRows, error: updatesError } = await supabase
        .from("production_updates")
        .select("order_id, stage, quantity_completed, update_date")
        .in("order_id", orderIds);
      if (updatesError) riskError = updatesError.message;
      else {
        updatesByOrder = new Map();
        for (const update of updateRows || []) {
          const key = String(update.order_id);
          const list = updatesByOrder.get(key) || [];
          list.push({ stage: update.stage, quantityCompleted: Number(update.quantity_completed), updateDate: update.update_date });
          updatesByOrder.set(key, list);
        }
      }
    }

    // Map database records into OrderItem UI objects
    const mappedOrders: OrderItem[] = rawOrders.map((row, index) => {
      const buyerObj = row.buyers as Record<string, unknown> | undefined;
      const clientName = String(
        buyerObj?.name ||
        buyerObj?.company_name ||
        row.buyer_name ||
        row.client ||
        row.company ||
        "Company"
      );

      const orderQty = Number(
        row.total_quantity ??
        row.order_quantity ??
        row.quantity ??
        0
      );

      const completedQty = Number(
        row.completed_quantity ??
        row.produced_quantity ??
        row.completed_units ??
        0
      );

      const delayRisk: DelayRiskResult | undefined = profile.role === "merchandiser"
        ? riskError
          ? { status: "Review Needed", remainingQuantity: null, daysRemaining: null, observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null, historyDates: 0, reason: "Production history could not be loaded." }
          : calculateDelayRisk({
            totalQuantity: row.total_quantity,
            completedQuantity: row.completed_quantity,
            finalProductionStage: row.final_production_stage,
            exFactoryDate: row.ex_factory_date,
          }, updatesByOrder.get(String(row.id || "")) || [])
        : undefined;
      const status = delayRisk ? delayRiskTone(delayRisk.status) : "neutral";
      const label = delayRisk?.status || "Review Needed";

      return {
        id: String(row.id || `order-${index + 1}`),
        poNumber: String(
          row.po_number ||
          row.order_number ||
          row.poNumber ||
          `PO-${index + 1}`
        ),
        client: clientName,
        style: String(
          row.style_name ||
          row.style ||
          row.item ||
          row.garment_style ||
          "Custom Style"
        ),
        colour: (row.colour || row.color) as string | undefined,
        buyerId: (row.buyer_id || "") as string | undefined,
        orderQuantity: orderQty,
        completedQuantity: completedQty,
        status,
        statusLabel: label,
        currentStage: String(row.current_stage || row.stage || "Knitting"),
        deliveryDate: formatDeliveryDate(
          row.ex_factory_date as string
        ),
        delayRisk,
      };
    });

    // Compute the 4 metrics strictly from real database records (Requirement 5)
    const metrics: MetricSummary = {
      totalOrders: mappedOrders.length,
      onTrack: mappedOrders.filter((o) => o.delayRisk?.status === "On Track" || o.delayRisk?.status === "Complete").length,
      atRisk: mappedOrders.filter((o) => o.delayRisk?.status === "Watch" || o.delayRisk?.status === "At Risk").length,
      delayed: mappedOrders.filter((o) => o.delayRisk?.status === "High Risk" || o.delayRisk?.status === "Overdue").length,
      weeklyTargetPcs: mappedOrders.reduce((sum, o) => sum + o.orderQuantity, 0),
      weeklyActualPcs: mappedOrders.reduce((sum, o) => sum + o.completedQuantity, 0),
    };

    // Build Upcoming Delivery Deadlines dynamically from real database order records
    const deadlines: DeadlineItem[] = mappedOrders.map((order) => ({
      id: order.id,
      poNumber: order.poNumber,
      client: order.client,
      style: order.style,
      dueDate: order.deliveryDate,
      daysRemaining: order.delayRisk?.daysRemaining ?? null,
      stage: order.currentStage,
      delayRisk: order.delayRisk || {
        status: "Review Needed", remainingQuantity: null, daysRemaining: null,
        observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null, historyDates: 0,
        reason: "Delay calculation is only available to merchandisers.",
      },
    }));
    deadlines.sort((a, b) => (a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER));

    return {
      orders: mappedOrders,
      metrics,
      deadlines,
      buyers: buyersList,
      riskError,
      error: null,
    };
  } catch (err: unknown) {
    const errorObj = err as Error;
    return {
      orders: [],
      metrics: {
        totalOrders: 0,
        onTrack: 0,
        atRisk: 0,
        delayed: 0,
        weeklyTargetPcs: 0,
        weeklyActualPcs: 0,
      },
      deadlines: [],
      buyers: [],
      riskError: null,
      error: {
        code: "UNEXPECTED_ERROR",
        message: errorObj.message || "An unexpected error occurred while fetching dashboard data",
        hint: null,
      },
    };
  }
}

/**
 * Server-side helper to fetch buyers directly from Supabase.
 */
export async function getBuyers(): Promise<Buyer[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("buyers")
      .select("*")
      .order("company_name", { ascending: true });

    if (error || !data) return [];
    return data.map((b: Record<string, unknown>) => ({
      id: String(b.id),
      name: String(b.company_name || "Company"),
    }));
  } catch {
    return [];
  }
}
