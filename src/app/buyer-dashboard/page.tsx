import { requireRole } from "@/lib/supabase/auth";
import { getBuyerPortalData } from "@/lib/supabase/buyer-portal";
import { BuyerDashboardClient } from "@/components/dashboard/BuyerDashboardClient";
import { redirect } from "next/navigation";

export const instant = false;

export default async function BuyerDashboardPage() {
  const profile = await requireRole("buyer");
  const data = await getBuyerPortalData(profile);
  if (data.invalidBuyerProfile) redirect("/access-denied?reason=invalid-role");

  return (
    <BuyerDashboardClient
      fullName={profile.fullName}
      companyName={data.companyName}
      companyError={data.companyError}
      orders={data.orders}
      orderError={data.orderError}
      updates={data.updates}
      updateError={data.updateError}
      milestones={data.milestones}
      milestoneError={data.milestoneError}
    />
  );
}
