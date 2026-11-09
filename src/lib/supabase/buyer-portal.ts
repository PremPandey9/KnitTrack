import "server-only";

import { createClient } from "@/lib/supabase/server";
import { UserProfile } from "@/lib/supabase/auth";

export interface BuyerPortalOrder {
  id: string;
  poNumber: string;
  styleName: string;
  colour: string;
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
  currentStage: string;
  exFactoryDate: string;
  finalProductionStage: string | null;
}

export interface BuyerPortalUpdate {
  id: string;
  orderId: string;
  updateDate: string;
  stage: string;
  quantityCompleted: number;
  issueNote: string | null;
  photoUrl: string | null;
}

export interface BuyerPortalMilestone {
  id: string;
  orderId: string;
  name: string;
  plannedDate: string | null;
  actualDate: string | null;
  status: string;
}

export interface BuyerPortalData {
  invalidBuyerProfile: boolean;
  companyName: string | null;
  companyError: string | null;
  orders: BuyerPortalOrder[];
  orderError: string | null;
  updates: BuyerPortalUpdate[];
  updateError: string | null;
  milestones: BuyerPortalMilestone[];
  milestoneError: string | null;
}

function valueAsString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function validPhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Uses the signed-in buyer's profile scope and the cookie-bound client; RLS remains active. */
export async function getBuyerPortalData(profile: UserProfile): Promise<BuyerPortalData> {
  if (profile.role !== "buyer" || !profile.buyerId) {
    return {
      invalidBuyerProfile: true,
      companyName: null,
      companyError: "Your profile is missing a valid buyer assignment.",
      orders: [],
      orderError: null,
      updates: [],
      updateError: null,
      milestones: [],
      milestoneError: null,
    };
  }

  try {
    const supabase = await createClient();
    const [buyerResult, orderResult] = await Promise.all([
      supabase.from("buyers").select("id, company_name").eq("id", profile.buyerId).maybeSingle(),
      supabase
        .from("orders")
        .select("id, buyer_id, po_number, style_name, colour, total_quantity, completed_quantity, current_stage, ex_factory_date, final_production_stage")
        .eq("buyer_id", profile.buyerId)
        .order("created_at", { ascending: false }),
    ]);

    const companyName = buyerResult.data?.company_name || null;
    const companyError = buyerResult.error
      ? `Could not load your company details: ${buyerResult.error.message}`
      : companyName
        ? null
        : "Your buyer profile does not match an available company record.";
    const invalidBuyerProfile = !buyerResult.error && !buyerResult.data;

    if (orderResult.error) {
      return {
        invalidBuyerProfile,
        companyName,
        companyError,
        orders: [],
        orderError: orderResult.error.message,
        updates: [],
        updateError: null,
        milestones: [],
        milestoneError: null,
      };
    }

    const orderRows = (orderResult.data || []).filter((row) => row.buyer_id === profile.buyerId);
    const orders: BuyerPortalOrder[] = orderRows.map((row) => {
      const totalQuantity = Number(row.total_quantity || 0);
      const completedQuantity = Number(row.completed_quantity || 0);
      const remainingQuantity = Math.max(0, totalQuantity - completedQuantity);
      return {
        id: row.id,
        poNumber: row.po_number || "PO",
        styleName: row.style_name || "Style not provided",
        colour: row.colour || "—",
        totalQuantity,
        completedQuantity,
        remainingQuantity,
        progressPercent: totalQuantity > 0
          ? Math.min(100, Math.max(0, Math.round((completedQuantity / totalQuantity) * 100)))
          : 0,
        currentStage: row.current_stage || "Not started",
        exFactoryDate: row.ex_factory_date,
        finalProductionStage: row.final_production_stage,
      };
    });

    if (orders.length === 0) {
      return {
        invalidBuyerProfile,
        companyName,
        companyError,
        orders,
        orderError: null,
        updates: [],
        updateError: null,
        milestones: [],
        milestoneError: null,
      };
    }

    const orderIds = orders.map((order) => order.id);
    const [updateResult, milestoneResult] = await Promise.all([
      supabase
        .from("production_updates")
        .select("id, order_id, stage, quantity_completed, issue_note, photo_url, update_date, created_at")
        .in("order_id", orderIds)
        .order("update_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("tna_milestones")
        .select("*")
        .in("order_id", orderIds),
    ]);

    const ownOrderIds = new Set(orderIds);
    const updates: BuyerPortalUpdate[] = (updateResult.data || [])
      .filter((row) => ownOrderIds.has(row.order_id))
      .map((row) => ({
        id: row.id,
        orderId: row.order_id,
        updateDate: row.update_date,
        stage: row.stage,
        quantityCompleted: Number(row.quantity_completed || 0),
        issueNote: row.issue_note,
        photoUrl: validPhotoUrl(row.photo_url),
      }));

    const milestones: BuyerPortalMilestone[] = ((milestoneResult.data || []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.order_id === "string" && ownOrderIds.has(row.order_id))
      .map((row, index) => ({
        id: String(row.id || `${row.order_id}-${index}`),
        orderId: String(row.order_id),
        name: valueAsString(row, ["milestone_name", "name", "title"]) || "Milestone",
        plannedDate: valueAsString(row, ["planned_date", "due_date", "target_date"]),
        actualDate: valueAsString(row, ["actual_date", "completed_date"]),
        status: valueAsString(row, ["status"]) || "Not started",
      }))
      .sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));

    return {
      invalidBuyerProfile,
      companyName,
      companyError,
      orders,
      orderError: null,
      updates,
      updateError: updateResult.error?.message || null,
      milestones,
      milestoneError: milestoneResult.error?.message || null,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not load buyer portal data.";
    return {
      invalidBuyerProfile: false,
      companyName: null,
      companyError: null,
      orders: [],
      orderError: message,
      updates: [],
      updateError: null,
      milestones: [],
      milestoneError: null,
    };
  }
}
