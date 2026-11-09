import { getDashboardData } from "@/lib/supabase/orders";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { requireProfile } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";
import { getOrderCreationOptions } from "@/lib/supabase/order-creation-options";
import { getPendingDelayAlertReviewQueue } from "@/lib/supabase/delay-alerts";

export const instant = false;

export default async function DashboardPage() {
  const profile = await requireProfile();
  if (profile.role === "buyer") redirect("/buyer-dashboard");
  if (profile.role === "supervisor") redirect("/production-tracking");
  const { orders, metrics, deadlines, error, riskError } = await getDashboardData(profile);
  const creationOptions = profile.role === "merchandiser"
    ? await getOrderCreationOptions()
    : { buyers: [], error: null };
  const delayAlertQueue = profile.role === "merchandiser"
    ? await getPendingDelayAlertReviewQueue()
    : { alerts: [], error: null };

  return (
    <DashboardClient
      initialOrders={orders}
      initialMetrics={metrics}
      initialDeadlines={deadlines}
      error={error}
      riskError={riskError}
      profile={profile}
      buyers={creationOptions.buyers}
      buyerOptionsError={creationOptions.error}
      pendingDelayAlerts={delayAlertQueue.alerts}
      delayAlertQueueError={delayAlertQueue.error}
    />
  );
}
