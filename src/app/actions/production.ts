"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export interface ProductionUpdateInput {
  orderId: string;
  stage: string;
  quantityCompleted: number;
  updateDate: string;
  issueNote: string;
}

export interface ProductionUpdateResult {
  success: boolean;
  error?: string;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calls one atomic, SECURITY INVOKER database function; no service-role client is used. */
export async function submitProductionUpdate(input: ProductionUpdateInput): Promise<ProductionUpdateResult> {
  const profile = await requireRole("merchandiser", "supervisor");
  const orderId = String(input?.orderId || "").trim();
  const stage = String(input?.stage || "").trim();
  const updateDate = String(input?.updateDate || "").trim();
  const issueNote = String(input?.issueNote || "").trim();
  const quantityCompleted = Number(input?.quantityCompleted);

  if (!orderId) return { success: false, error: "Select a production order." };
  if (!stage) return { success: false, error: "Enter or select a production stage." };
  if (!Number.isSafeInteger(quantityCompleted) || quantityCompleted <= 0) {
    return { success: false, error: "Quantity completed must be a positive whole number." };
  }
  if (!isValidDate(updateDate)) return { success: false, error: "Choose a valid update date." };
  if (issueNote.length > 2000) return { success: false, error: "Issue note must be 2,000 characters or fewer." };

  try {
    const supabase = await createClient();
    let orderQuery = supabase.from("orders").select("id, assigned_supervisor_id").eq("id", orderId);
    if (profile.role === "supervisor") {
      orderQuery = orderQuery.eq("assigned_supervisor_id", profile.id);
    }
    const { data: order, error: orderError } = await orderQuery.maybeSingle();
    if (orderError) return { success: false, error: `Could not verify order access: ${orderError.message}` };
    if (!order) return { success: false, error: "This order is not available to your account." };

    const { error } = await supabase.rpc("submit_production_update", {
      p_order_id: orderId,
      p_stage: stage,
      p_quantity_completed: quantityCompleted,
      p_issue_note: issueNote || null,
      p_update_date: updateDate,
    });

    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return {
          success: false,
          error: "The atomic production update database function has not been installed. No update was saved. Ask an administrator to review the required SQL migration.",
        };
      }
      return { success: false, error: `Could not save the production update: ${error.message}` };
    }

    revalidatePath("/production-tracking", "page");
    revalidatePath("/", "page");
    revalidatePath("/orders", "page");
    return { success: true };
  } catch (cause) {
    return {
      success: false,
      error: cause instanceof Error ? cause.message : "An unexpected error occurred while saving the update.",
    };
  }
}
