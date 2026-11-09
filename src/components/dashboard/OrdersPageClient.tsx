"use client";

import { useMemo, useState } from "react";
import { OrdersPageItem } from "@/lib/supabase/orders-page";
import { UserProfile } from "@/lib/supabase/auth";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DelayRiskSummary } from "@/components/dashboard/DelayRiskSummary";

interface OrdersPageClientProps {
  orders: OrdersPageItem[];
  error: { code?: string; message: string } | null;
  riskError: string | null;
  profile: UserProfile;
}

export function OrdersPageClient({ orders, error, riskError, profile }: OrdersPageClientProps) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const stages = useMemo(() => [...new Set(orders.map((order) => order.stage).filter((value) => value !== "—"))].sort(), [orders]);
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch = !term || [order.poNumber, order.style, order.buyer]
        .some((value) => value.toLowerCase().includes(term));
      return matchesSearch && (stage === "all" || order.stage === stage) &&
        (deliveryStatus === "all" || order.deliveryStatus === deliveryStatus);
    });
  }, [orders, search, stage, deliveryStatus]);

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar
        fullName={profile.fullName}
        role={profile.role}
        currentTab="orders"
        onSelectTab={() => undefined}
        isOpenMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Header
          fullName={profile.fullName}
          role={profile.role}
          canCreateOrder={false}
          title="Production Orders"
          subtitle="Search and review production orders from your workspace."
          showSearch={false}
          showLiveFeed={false}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenCreateOrder={() => undefined}
          searchQuery={search}
          onSearchChange={setSearch}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Orders</h2>
            <p className="text-sm text-slate-500">Production order details and delivery progress.</p>
          </div>

          {riskError && profile.role === "merchandiser" && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Production history could not be read: {riskError}. Orders are marked Review Needed.</div>}

          <Card>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="order-search" className="mb-1 block text-xs font-semibold text-slate-600">Search PO, style or buyer</label>
                <input id="order-search" value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Type to search orders" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label htmlFor="stage-filter" className="mb-1 block text-xs font-semibold text-slate-600">Production stage</label>
                <select id="stage-filter" value={stage} onChange={(event) => setStage(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="all">All stages</option>
                  {stages.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="delivery-filter" className="mb-1 block text-xs font-semibold text-slate-600">Delivery status</label>
                <select id="delivery-filter" value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="all">All statuses</option>
                  <option value="green">On Track</option>
                  <option value="amber">At Risk</option>
                  <option value="red">Delayed</option>
                </select>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Production orders" subtitle={error ? "Orders could not be loaded." : `${filteredOrders.length} orders shown`} />
            {error ? (
              <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p className="font-semibold">Unable to load orders</p>
                <p className="mt-1 break-words">{error.message}{error.code ? ` (${error.code})` : ""}</p>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-800">{orders.length ? "No orders match these filters" : "No orders found"}</p>
                <p className="mt-1 text-sm text-slate-500">{orders.length ? "Try changing your search or filters." : "Orders available to your account will appear here."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-left text-sm">
                  <thead className="border-y border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">PO Number</th><th className="px-4 py-3">Buyer</th><th className="px-4 py-3">Style</th><th className="px-4 py-3">Colour</th><th className="px-4 py-3 text-right">Total qty</th><th className="px-4 py-3 text-right">Completed</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Ex-factory</th><th className="px-4 py-3">Supervisor</th><th className="px-4 py-3">Delivery status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{order.poNumber}</td>
                        <td className="px-4 py-4">{order.buyer}</td><td className="px-4 py-4">{order.style}</td><td className="px-4 py-4">{order.colour}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{order.totalQuantity.toLocaleString()}</td><td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{order.completedQuantity.toLocaleString()}</td>
                        <td className="px-4 py-4"><span className="whitespace-nowrap rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-medium">{order.stage}</span></td>
                        <td className="whitespace-nowrap px-4 py-4">{order.exFactoryDate}</td><td className="px-4 py-4">{order.supervisor}</td>
                        <td className="px-4 py-4">{profile.role === "merchandiser" && order.delayRisk ? <div className="min-w-[240px]"><DelayRiskSummary risk={order.delayRisk} compact /></div> : <Badge status={order.deliveryStatus}>{profile.role === "buyer" ? "Progress only" : order.deliveryStatusLabel}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
}
