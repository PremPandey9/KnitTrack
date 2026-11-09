"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/supabase/auth";
import { OrderItem } from "@/types/dashboard";
import { formatDeliveryDate } from "@/lib/supabase/orders";
import PRODUCTION_STAGES from "@/lib/production-stages.json";

export interface CreateOrderParams {
  poNumber: string;
  buyerId: string;
  styleName: string;
  colour: string;
  totalQuantity: number;
  currentStage: string;
  finalProductionStage: string;
  exFactoryDate: string;
}

export interface CreateOrderResponse {
  success: boolean;
  order?: OrderItem;
  error?: string;
  code?: string;
}

export interface SupervisorAssignmentResponse {
  success: boolean;
  error?: string;
}

export interface FinalProductionStageResponse {
  success: boolean;
  error?: string;
}

/** Calls the installed database function, which also checks the caller's merchandiser role. */
export async function configureOrderFinalStageAction(
  orderIdInput: string,
  finalStageInput: string,
): Promise<FinalProductionStageResponse> {
  await requireRole("merchandiser");

  const orderId = String(orderIdInput || "").trim().toLowerCase();
  const finalStage = String(finalStageInput || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(orderId)) return { success: false, error: "Select a valid production order." };
  if (!PRODUCTION_STAGES.includes(finalStage)) return { success: false, error: "Choose a valid final production stage." };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("configure_order_final_stage", {
      p_order_id: orderId,
      p_final_production_stage: finalStage,
    });

    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return { success: false, error: "The final-stage configuration function is unavailable. Ask an administrator to verify the Supabase function." };
      }
      return { success: false, error: `Could not save the final production stage: ${error.message}` };
    }
    if (typeof data !== "string" || data.toLowerCase() !== orderId) {
      return { success: false, error: "Supabase did not confirm the order's final-stage change." };
    }

    revalidatePath("/production-tracking", "page");
    revalidatePath("/orders", "page");
    revalidatePath("/", "page");
    return { success: true };
  } catch (cause) {
    return { success: false, error: cause instanceof Error ? cause.message : "An unexpected error occurred while saving the final stage." };
  }
}

/** Assigns an existing supervisor (or clears assignment) for a merchandiser. */
export async function assignOrderSupervisorAction(
  orderIdInput: string,
  supervisorIdInput: string | null,
): Promise<SupervisorAssignmentResponse> {
  await requireRole("merchandiser");

  const orderId = String(orderIdInput || "").trim();
  const supervisorId = supervisorIdInput === null ? null : String(supervisorIdInput || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(orderId)) return { success: false, error: "Select a valid production order." };
  if (supervisorId !== null && !uuidPattern.test(supervisorId)) {
    return { success: false, error: "Select a valid supervisor, or choose Unassigned." };
  }

  try {
    const supabase = await createClient();
    if (supervisorId) {
      const { data: supervisor, error: supervisorError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", supervisorId)
        .eq("role", "supervisor")
        .maybeSingle();
      if (supervisorError) return { success: false, error: "Could not verify that supervisor. Check profile access and try again." };
      if (!supervisor) return { success: false, error: "That supervisor is unavailable. Refresh and select an available supervisor." };
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ assigned_supervisor_id: supervisorId })
      .eq("id", orderId)
      .select("id")
      .maybeSingle();
    if (error) return { success: false, error: `Could not save supervisor assignment: ${error.message}` };
    if (!data) return { success: false, error: "The order could not be updated. Check order access and database permissions." };

    revalidatePath("/production-tracking", "page");
    revalidatePath("/orders", "page");
    revalidatePath("/", "page");
    return { success: true };
  } catch (cause) {
    return { success: false, error: cause instanceof Error ? cause.message : "An unexpected error occurred while assigning the supervisor." };
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Creates an order only after validating the current user and all client input. */
export async function createOrderAction(params: CreateOrderParams): Promise<CreateOrderResponse> {
  await requireRole("merchandiser");

  const poNumber = String(params?.poNumber || "").trim();
  const buyerId = String(params?.buyerId || "").trim();
  const styleName = String(params?.styleName || "").trim();
  const colour = String(params?.colour || "").trim();
  const exFactoryDate = String(params?.exFactoryDate || "").trim();
  const currentStage = String(params?.currentStage || "").trim();
  const finalProductionStage = String(params?.finalProductionStage || "Finishing").trim();
  const totalQuantity = Number(params?.totalQuantity);

  if (!poNumber) return { success: false, error: "Enter a PO number." };
  if (!buyerId) return { success: false, error: "Select a buyer company." };
  if (!styleName) return { success: false, error: "Enter a style name." };
  if (!colour) return { success: false, error: "Enter a colour." };
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity <= 0) {
    return { success: false, error: "Total quantity must be a positive whole number." };
  }
  if (!isValidDate(exFactoryDate)) {
    return { success: false, error: "Choose a valid ex-factory date." };
  }
  if (!PRODUCTION_STAGES.includes(currentStage)) {
    return { success: false, error: "Choose a valid initial production stage." };
  }
  if (!PRODUCTION_STAGES.includes(finalProductionStage)) {
    return { success: false, error: "Choose a valid final production stage." };
  }

  try {
    const supabase = await createClient();

    const { data: duplicate, error: duplicateError } = await supabase
      .from("orders")
      .select("id")
      .eq("po_number", poNumber)
      .maybeSingle();
    if (duplicateError) {
      return {
        success: false,
        error: "KnitTrack could not verify whether this PO number is already in use. Check your access and try again.",
        code: duplicateError.code,
      };
    }
    if (duplicate) return { success: false, error: `PO number “${poNumber}” is already in use.` };

    const { data: buyer, error: buyerError } = await supabase
      .from("buyers")
      .select("*")
      .eq("id", buyerId)
      .maybeSingle();
    if (buyerError) {
      return { success: false, error: `Could not verify the selected buyer: ${buyerError.message}`, code: buyerError.code };
    }
    if (!buyer) return { success: false, error: "That buyer is unavailable. Refresh the page and select an existing buyer." };

    const { data: insertedOrder, error: insertError } = await supabase
      .from("orders")
      .insert({
        po_number: poNumber,
        buyer_id: buyerId,
        style_name: styleName,
        colour,
        total_quantity: totalQuantity,
        completed_quantity: 0,
        current_stage: currentStage,
        final_production_stage: finalProductionStage,
        ex_factory_date: exFactoryDate,
      })
      .select("*")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return { success: false, error: `PO number “${poNumber}” is already in use.`, code: insertError.code };
      }
      return {
        success: false,
        error: `Supabase could not save this order: ${insertError.message}`,
        code: insertError.code,
      };
    }
    if (!insertedOrder) return { success: false, error: "Supabase did not return the saved order." };

    const buyerName = String(buyer.company_name || "Buyer");
    const createdOrder: OrderItem = {
      id: String(insertedOrder.id),
      poNumber: String(insertedOrder.po_number),
      client: buyerName,
      style: String(insertedOrder.style_name || styleName),
      colour: String(insertedOrder.colour || colour),
      buyerId,
      orderQuantity: Number(insertedOrder.total_quantity ?? totalQuantity),
      completedQuantity: Number(insertedOrder.completed_quantity ?? 0),
      status: "neutral",
      statusLabel: "Review Needed",
      currentStage: String(insertedOrder.current_stage || currentStage),
      deliveryDate: formatDeliveryDate(String(insertedOrder.ex_factory_date || exFactoryDate)),
      delayRisk: {
        status: "Review Needed",
        remainingQuantity: Number(insertedOrder.total_quantity ?? totalQuantity),
        daysRemaining: null,
        observedDailyOutput: null,
        requiredDailyOutput: null,
        paceRatio: null,
        historyDates: 0,
        reason: "A new order needs sufficient final-stage history before a pace classification is available.",
      },
    };

    revalidatePath("/", "page");
    revalidatePath("/orders", "page");
    return { success: true, order: createdOrder };
  } catch (cause) {
    return {
      success: false,
      error: cause instanceof Error ? cause.message : "An unexpected error occurred while saving the order.",
    };
  }
}
