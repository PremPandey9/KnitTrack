"use client";

import { useState } from "react";
import type { BuyerPortalMilestone, BuyerPortalOrder, BuyerPortalUpdate } from "@/lib/supabase/buyer-portal";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface Props {
  fullName: string;
  companyName: string | null;
  companyError: string | null;
  orders: BuyerPortalOrder[];
  orderError: string | null;
  updates: BuyerPortalUpdate[];
  updateError: string | null;
  milestones: BuyerPortalMilestone[];
  milestoneError: string | null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ErrorNotice({ title, message }: { title: string; message: string }) {
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><strong>{title}</strong><p className="mt-1 break-words">{message}</p></div>;
}

export function BuyerDashboardClient({
  fullName,
  companyName,
  companyError,
  orders,
  orderError,
  updates,
  updateError,
  milestones,
  milestoneError,
}: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar
        fullName={fullName}
        role="buyer"
        currentTab="buyer"
        onSelectTab={() => undefined}
        isOpenMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Header
          fullName={fullName}
          role="buyer"
          canCreateOrder={false}
          title="Buyer Portal"
          subtitle="Read-only order progress and production updates."
          showSearch={false}
          showLiveFeed={false}
          showNotifications={false}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenCreateOrder={() => undefined}
          searchQuery=""
          onSearchChange={() => undefined}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 sm:p-6 lg:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Buyer account</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{companyName || "Your company"}</h2>
            <p className="mt-1 text-sm text-slate-500">View your production orders, stage progress, and TNA milestones.</p>
          </div>

          {companyError && <ErrorNotice title="Company details unavailable" message={companyError} />}
          {orderError && <ErrorNotice title="Orders could not be loaded" message={orderError} />}
          {updateError && <ErrorNotice title="Production history is unavailable" message={updateError} />}
          {milestoneError && <ErrorNotice title="TNA milestones are unavailable" message={milestoneError} />}

          {!orderError && orders.length === 0 ? (
            <Card><CardContent className="py-14 text-center">
              <p className="font-semibold text-slate-800">No production orders yet</p>
              <p className="mt-1 text-sm text-slate-500">Your company’s orders will appear here when they are available.</p>
            </CardContent></Card>
          ) : orders.map((order) => {
            const orderUpdates = updates.filter((update) => update.orderId === order.id);
            const orderMilestones = milestones.filter((milestone) => milestone.orderId === order.id);

            return (
              <article key={order.id} className="space-y-4">
                <Card>
                  <CardHeader
                    title={<span>{order.poNumber}<span className="ml-2 font-normal text-slate-500">{order.styleName} · {order.colour}</span></span>}
                    subtitle="Production order progress"
                    action={<Badge status="blue">{order.currentStage}</Badge>}
                  />
                  <div className="space-y-4 p-4 sm:p-5">
                    <ProgressBar current={order.completedQuantity} total={order.totalQuantity} showLabels />
                    <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                      <Quantity label="Total quantity" value={order.totalQuantity} />
                      <Quantity label="Finished goods" value={order.completedQuantity} />
                      <Quantity label="Remaining" value={order.remainingQuantity} />
                      <div><span className="block text-xs text-slate-500">Progress</span><strong className="mt-1 block">{order.progressPercent}%</strong></div>
                      <div><span className="block text-xs text-slate-500">Ex-factory</span><strong className="mt-1 block">{formatDate(order.exFactoryDate)}</strong></div>
                      <div><span className="block text-xs text-slate-500">Final production stage</span><strong className="mt-1 block">{order.finalProductionStage || "Not configured"}</strong></div>
                    </div>
                  </div>
                </Card>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Card className="overflow-hidden">
                    <CardHeader title="Production update history" subtitle={`${orderUpdates.length} updates`} />
                    {orderUpdates.length === 0 ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-500">{updateError ? "History could not be loaded." : "No production updates recorded yet."}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-left text-sm">
                          <thead className="border-y border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3 text-right">Daily quantity</th><th className="px-4 py-3">Issue / photo</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {orderUpdates.map((update) => <tr key={update.id} className="align-top text-slate-700">
                              <td className="whitespace-nowrap px-4 py-3">{formatDate(update.updateDate)}</td>
                              <td className="px-4 py-3"><Badge status="blue">{update.stage}</Badge></td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{update.quantityCompleted.toLocaleString()} pcs</td>
                              <td className="max-w-xs px-4 py-3"><span className="whitespace-pre-wrap break-words">{update.issueNote || "—"}</span>{update.photoUrl && <a href={update.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs font-semibold text-blue-700 underline">View photo</a>}</td>
                            </tr>)}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>

                  <Card>
                    <CardHeader title="TNA milestones" subtitle={`${orderMilestones.length} milestones`} />
                    {orderMilestones.length === 0 ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-500">{milestoneError ? "Milestones could not be loaded." : "No milestones recorded yet."}</p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {orderMilestones.map((milestone) => <div key={milestone.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div><p className="text-sm font-semibold text-slate-800">{milestone.name}</p><p className="mt-0.5 text-xs text-slate-500">Planned: {formatDate(milestone.plannedDate)} · Actual: {formatDate(milestone.actualDate)}</p></div>
                          <Badge status="neutral">{milestone.status}</Badge>
                        </div>)}
                      </div>
                    )}
                  </Card>
                </div>
              </article>
            );
          })}
        </main>
      </div>
    </div>
  );
}

function Quantity({ label, value }: { label: string; value: number }) {
  return <div><span className="block text-xs text-slate-500">{label}</span><strong className="mt-1 block tabular-nums">{value.toLocaleString()} pcs</strong></div>;
}
