import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/supabase/auth";
import { getOrdersPageData } from "@/lib/supabase/orders-page";
import { OrdersPageClient } from "@/components/dashboard/OrdersPageClient";

export const instant = false;

export default async function OrdersPage() {
  const profile = await requireProfile();
  if (profile.role === "supervisor") redirect("/production-tracking");

  const result = await getOrdersPageData(profile);
  return <OrdersPageClient orders={result.orders} error={result.error} riskError={result.riskError} profile={profile} />;
}
