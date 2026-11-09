import "server-only";

import { createClient } from "@/lib/supabase/server";
import { UserProfile } from "@/lib/supabase/auth";
import { calculateDelayRisk, DelayRiskResult } from "@/lib/delay-risk";

export interface ProductionOrder {
  id: string;
  poNumber: string;
  buyer: string;
  style: string;
  colour: string;
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  currentStage: string;
  finalProductionStage: string | null;
  exFactoryDate: string;
  supervisorId: string | null;
  supervisorName: string;
  delayRisk: DelayRiskResult;
}

export interface ProductionUpdate {
  id: string;
  orderId: string;
  poNumber: string;
  stage: string;
  quantityCompleted: number;
  updateDate: string;
  issueNote: string | null;
  photoUrl: string | null;
  supervisorId: string | null;
  supervisorName: string;
}

export interface ProductionTrackingData {
  orders: ProductionOrder[];
  updates: ProductionUpdate[];
  availableSupervisors: Array<{ id: string; fullName: string }>;
  supervisorListError: string | null;
  orderError: string | null;
  updateError: string | null;
}

/** Fetches with the current user's cookie-backed Supabase client; database RLS remains active. */
export async function getProductionTrackingData(profile: UserProfile): Promise<ProductionTrackingData> {
  const supabase = await createClient();
  let orderQuery = supabase
    .from("orders")
    .select("id, po_number, buyer_id, style_name, colour, total_quantity, completed_quantity, current_stage, final_production_stage, ex_factory_date, assigned_supervisor_id")
    .order("created_at", { ascending: false });

  if (profile.role === "supervisor") {
    orderQuery = orderQuery.eq("assigned_supervisor_id", profile.id);
  }

  const { data: orderRows, error: orderQueryError } = await orderQuery;
  if (orderQueryError) {
    return { orders: [], updates: [], availableSupervisors: [], supervisorListError: null, orderError: orderQueryError.message, updateError: null };
  }

  let availableSupervisors: Array<{ id: string; fullName: string }> = [];
  let supervisorListError: string | null = null;
  if (profile.role === "merchandiser") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "supervisor")
      .order("full_name", { ascending: true });
    if (error) supervisorListError = error.message;
    else availableSupervisors = (data || []).map((person) => ({ id: person.id, fullName: person.full_name || "Supervisor" }));
  }

  const rows = orderRows || [];
  if (!rows.length) {
    return { orders: [], updates: [], availableSupervisors, supervisorListError, orderError: null, updateError: null };
  }

  const buyerIds = [...new Set(rows.map((row) => row.buyer_id).filter((id): id is string => Boolean(id)))];
  let buyerRows: Array<{ id: string; company_name: string }> = [];
  if (buyerIds.length) {
    const buyerResult = await supabase.from("buyers").select("id, company_name").in("id", buyerIds);
    if (buyerResult.error) {
      return { orders: [], updates: [], availableSupervisors, supervisorListError, orderError: buyerResult.error.message, updateError: null };
    }
    buyerRows = buyerResult.data || [];
  }
  const buyersById = new Map((buyerRows || []).map((buyer) => [buyer.id, buyer.company_name]));

  const supervisorIds = [...new Set(rows.map((row) => row.assigned_supervisor_id).filter((id): id is string => Boolean(id)))];
  let supervisorRows: Array<{ id: string; full_name: string }> = [];
  if (supervisorIds.length) {
    const supervisorResult = await supabase.from("profiles").select("id, full_name").in("id", supervisorIds);
    supervisorRows = supervisorResult.data || [];
  }
  const supervisorsById = new Map((supervisorRows || []).map((person) => [person.id, person.full_name]));

  const orders: ProductionOrder[] = rows.map((row) => {
    const totalQuantity = Number(row.total_quantity || 0);
    const completedQuantity = Number(row.completed_quantity || 0);
    const supervisorId = row.assigned_supervisor_id || null;
    return {
      id: row.id,
      poNumber: row.po_number,
      buyer: buyersById.get(row.buyer_id) || "Buyer unavailable",
      style: row.style_name,
      colour: row.colour,
      totalQuantity,
      completedQuantity,
      remainingQuantity: Math.max(0, totalQuantity - completedQuantity),
      currentStage: row.current_stage,
      finalProductionStage: row.final_production_stage,
      exFactoryDate: row.ex_factory_date,
      supervisorId,
      supervisorName: supervisorId
        ? supervisorsById.get(supervisorId) || (supervisorId === profile.id ? profile.fullName : "Supervisor")
        : "Unassigned",
      delayRisk: {
        status: "Review Needed", remainingQuantity: Math.max(0, totalQuantity - completedQuantity), daysRemaining: null,
        observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null,
        historyDates: 0, reason: "Production history is being loaded.",
      },
    };
  });

  const orderIds = orders.map((order) => order.id);
  const { data: updateRows, error: updateQueryError } = await supabase
    .from("production_updates")
    .select("id, order_id, stage, quantity_completed, issue_note, photo_url, update_date, supervisor_id, created_at")
    .in("order_id", orderIds)
    .order("update_date", { ascending: false })
    .order("created_at", { ascending: false });

  const updateSupervisorIds = [...new Set((updateRows || []).map((row) => row.supervisor_id).filter((id): id is string => Boolean(id)))];
  let updateSupervisorRows: Array<{ id: string; full_name: string }> = [];
  if (updateSupervisorIds.length) {
    const updateSupervisorResult = await supabase.from("profiles").select("id, full_name").in("id", updateSupervisorIds);
    updateSupervisorRows = updateSupervisorResult.data || [];
  }
  const updateSupervisorsById = new Map((updateSupervisorRows || []).map((person) => [person.id, person.full_name]));
  const poByOrderId = new Map(orders.map((order) => [order.id, order.poNumber]));

  const updates: ProductionUpdate[] = (updateRows || []).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    poNumber: poByOrderId.get(row.order_id) || "Order",
    stage: row.stage,
    quantityCompleted: Number(row.quantity_completed || 0),
    updateDate: row.update_date,
    issueNote: row.issue_note,
    photoUrl: row.photo_url,
    supervisorId: row.supervisor_id,
    supervisorName: row.supervisor_id
      ? updateSupervisorsById.get(row.supervisor_id) || (row.supervisor_id === profile.id ? profile.fullName : "Supervisor")
      : "Merchandiser",
  }));

  const updatesByOrder = new Map<string, ProductionUpdate[]>();
  for (const update of updates) {
    const list = updatesByOrder.get(update.orderId) || [];
    list.push(update);
    updatesByOrder.set(update.orderId, list);
  }
  const sourceOrderById = new Map(rows.map((row) => [row.id, row]));
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const sourceOrder = sourceOrderById.get(order.id);
    orders[index] = {
      ...order,
      delayRisk: updateQueryError
        ? {
          status: "Review Needed", remainingQuantity: order.remainingQuantity, daysRemaining: null,
          observedDailyOutput: null, requiredDailyOutput: null, paceRatio: null,
          historyDates: 0, reason: "Production history could not be loaded.",
        }
        : calculateDelayRisk({
          totalQuantity: sourceOrder?.total_quantity,
          completedQuantity: sourceOrder?.completed_quantity,
          finalProductionStage: sourceOrder?.final_production_stage,
          exFactoryDate: sourceOrder?.ex_factory_date,
        }, (updatesByOrder.get(order.id) || []).map((update) => ({
          stage: update.stage,
          quantityCompleted: update.quantityCompleted,
          updateDate: update.updateDate,
        }))),
    };
  }

  return {
    orders,
    updates,
    availableSupervisors,
    supervisorListError,
    orderError: null,
    updateError: updateQueryError?.message || null,
  };
}
