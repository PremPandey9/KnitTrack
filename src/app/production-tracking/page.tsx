import { requireRole } from "@/lib/supabase/auth";
import { getProductionTrackingData } from "@/lib/supabase/production";
import { ProductionTrackingClient } from "@/components/dashboard/ProductionTrackingClient";

export const instant = false;

export default async function ProductionTrackingPage() {
  const profile = await requireRole("merchandiser", "supervisor");
  const data = await getProductionTrackingData(profile);

  return (
    <ProductionTrackingClient
      profile={profile}
      orders={data.orders}
      updates={data.updates}
      availableSupervisors={data.availableSupervisors}
      supervisorListError={data.supervisorListError}
      orderError={data.orderError}
      updateError={data.updateError}
    />
  );
}
