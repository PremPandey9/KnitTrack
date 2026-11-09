import type { DelayRiskResult } from "@/lib/delay-risk";
import type { DelayRiskStatus } from "@/lib/delay-risk";

export type OrderStatus = "green" | "amber" | "red" | "neutral";

export interface Buyer {
  id: string;
  name: string;
}

export interface OrderItem {
  id: string;
  poNumber: string;
  client: string;
  style: string;
  colour?: string;
  buyerId?: string;
  orderQuantity: number;
  completedQuantity: number;
  status: OrderStatus;
  statusLabel: DelayRiskStatus | "Delayed";
  currentStage: string;
  deliveryDate: string;
  delayRisk?: DelayRiskResult;
}

export interface MetricSummary {
  totalOrders: number;
  onTrack: number;
  atRisk: number;
  delayed: number;
  weeklyTargetPcs: number;
  weeklyActualPcs: number;
}

export interface DeadlineItem {
  id: string;
  poNumber: string;
  client: string;
  style: string;
  dueDate: string;
  daysRemaining: number | null;
  stage: string;
  delayRisk: DelayRiskResult;
}

export interface DailyProductionStat {
  day: string;
  target: number;
  actual: number;
  cutting: number;
  sewing: number;
  finishing: number;
}
