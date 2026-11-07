export type OrderStatus = "green" | "amber" | "red";

export interface OrderItem {
  id: string;
  poNumber: string;
  client: string;
  style: string;
  orderQuantity: number;
  completedQuantity: number;
  status: OrderStatus;
  statusLabel: "On Track" | "At Risk" | "Delayed";
  currentStage: "Knitting" | "Dyeing" | "Cutting" | "Sewing" | "Finishing" | "Quality Check";
  deliveryDate: string;
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
  daysRemaining: number;
  stage: string;
  urgency: "critical" | "warning" | "normal";
  bottleneckReason?: string;
}

export interface DailyProductionStat {
  day: string;
  target: number;
  actual: number;
  cutting: number;
  sewing: number;
  finishing: number;
}
