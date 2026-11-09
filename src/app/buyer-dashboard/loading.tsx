import { Card } from "@/components/ui/Card";

export default function BuyerDashboardLoading() {
  return (
    <main aria-label="Loading buyer portal" className="min-h-screen space-y-5 bg-slate-50 p-4 sm:p-6 lg:p-8 lg:pl-72">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      {[1, 2].map((item) => <Card key={item} className="h-56 animate-pulse bg-white"><div /></Card>)}
    </main>
  );
}
