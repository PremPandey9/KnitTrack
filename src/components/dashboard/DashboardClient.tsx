"use client";

import React, { startTransition, useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderItem, MetricSummary, DeadlineItem } from "@/types/dashboard";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { DelayCalculationInfo } from "@/components/dashboard/DelayCalculationInfo";
import { OrdersTable } from "@/components/dashboard/OrdersTable";
import { UpcomingDeadlines } from "@/components/dashboard/UpcomingDeadlines";
import { CreateOrderModal } from "@/components/dashboard/CreateOrderModal";
import { DelayAlertIcon } from "@/components/icons/Icons";
import { UserProfile } from "@/lib/supabase/auth";
import { Buyer } from "@/types/dashboard";
import { DelayAlertReviewQueue } from "@/components/dashboard/DelayAlertReviewQueue";
import type { DelayAlertReviewItem } from "@/lib/supabase/delay-alerts";

interface DashboardClientProps {
  initialOrders: OrderItem[];
  initialMetrics: MetricSummary;
  initialDeadlines?: DeadlineItem[];
  error?: {
    code?: string;
    message: string;
    hint?: string | null;
  } | null;
  profile: UserProfile;
  buyers: Buyer[];
  buyerOptionsError: string | null;
  riskError?: string | null;
  pendingDelayAlerts: DelayAlertReviewItem[];
  delayAlertQueueError: string | null;
}

export function DashboardClient({
  initialOrders,
  initialMetrics,
  initialDeadlines = [],
  error = null,
  profile,
  buyers,
  buyerOptionsError,
  riskError = null,
  pendingDelayAlerts,
  delayAlertQueueError,
}: DashboardClientProps) {
  const router = useRouter();
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "green" | "amber" | "red">("all");

  const [orders, addOptimisticOrder] = useOptimistic(
    initialOrders,
    (currentOrders, newOrder: OrderItem) => [newOrder, ...currentOrders]
  );
  const deadlines = initialDeadlines;
  const delayAlertCount = orders.filter((order) => ["Overdue", "High Risk", "At Risk", "Watch"].includes(order.delayRisk?.status || "")).length;
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Calculate live metrics strictly from database records (Requirement 5)
  const metrics: MetricSummary = {
    totalOrders: orders.length,
    onTrack: orders.filter((o) => o.delayRisk?.status === "On Track" || o.delayRisk?.status === "Complete").length,
    atRisk: orders.filter((o) => o.delayRisk?.status === "Watch" || o.delayRisk?.status === "At Risk").length,
    delayed: orders.filter((o) => o.delayRisk?.status === "High Risk" || o.delayRisk?.status === "Overdue").length,
    weeklyTargetPcs:
      orders.length > 0
        ? orders.reduce((sum, o) => sum + o.orderQuantity, 0)
        : initialMetrics.weeklyTargetPcs,
    weeklyActualPcs:
      orders.length > 0
        ? orders.reduce((sum, o) => sum + o.completedQuantity, 0)
        : initialMetrics.weeklyActualPcs,
  };

  const handleAddOrder = (newOrder: OrderItem) => {
    startTransition(() => {
      addOptimisticOrder(newOrder);
      router.refresh();
    });
    showToast(`Order ${newOrder.poNumber} saved to Supabase.`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* 1. Dark Navy Sidebar */}
      <Sidebar
        fullName={profile.fullName}
        role={profile.role}
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          if (tab === "delays") {
            document.getElementById("delay-alert-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (tab !== "dashboard") {
            showToast(`Switched to "${tab.charAt(0).toUpperCase() + tab.slice(1)}" view`);
          }
        }}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        delayAlertCount={delayAlertCount}
      />

      {/* Main Content Area (Offset by Sidebar on Desktop) */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* 2. Top Navigation Header */}
        <Header
          fullName={profile.fullName}
          role={profile.role}
          canCreateOrder={profile.role === "merchandiser"}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenCreateOrder={() => setIsCreateModalOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Dashboard Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Supabase Connection Notice / Error State (Requirement 8 & 10) */}
          {error && (
            <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0 mt-0.5">
                <DelayAlertIcon className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-amber-950 text-sm flex items-center gap-2">
                  <span>Supabase Database Notice</span>
                  {error.code && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900 font-mono">
                      Code: {error.code}
                    </span>
                  )}
                </div>
                <p className="text-amber-800">
                  {error.message}
                </p>
                {error.hint && (
                  <p className="text-amber-700 italic">
                    <strong>Hint:</strong> {error.hint}
                  </p>
                )}
                <p className="text-slate-600 text-[11px] pt-0.5">
                  Row Level Security (RLS) or PostgreSQL table privileges are currently restricting unauthenticated reading. Security policies have been strictly preserved.
                </p>
              </div>
            </div>
          )}
          {riskError && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Delay calculations need production history</p>
              <p className="mt-1">{riskError} Affected orders are marked Review Needed until history can be read.</p>
            </div>
          )}

          {profile.role === "merchandiser" && (
            <DelayAlertReviewQueue alerts={pendingDelayAlerts} error={delayAlertQueueError} />
          )}

          {/* Quick Filter Active Notice */}
          {statusFilter !== "all" && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/80 border border-blue-200 text-xs text-blue-900">
              <span className="font-medium">
                Filtering recent orders by status:{" "}
                <strong className="uppercase">
                  {statusFilter === "green"
                    ? "On Track"
                    : statusFilter === "amber"
                    ? "At Risk"
                    : "Delayed"}
                </strong>
              </span>
              <button
                suppressHydrationWarning
                onClick={() => setStatusFilter("all")}
                className="font-bold underline text-blue-700 hover:text-blue-900 ml-2"
              >
                Clear Filter
              </button>
            </div>
          )}

          {/* 3. Four Overview Metric Cards (Requirement 5) */}
          <section aria-label="Key Performance Metrics">
            <MetricCards
              metrics={metrics}
              selectedFilter={statusFilter}
              onFilterChange={setStatusFilter}
            />
          </section>

          {/* 4. Production Chart & 6. Upcoming Deadlines Grid */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <DelayCalculationInfo />

            {/* 6. Upcoming Deadlines Section */}
            <div className="col-span-1">
              <UpcomingDeadlines deadlines={deadlines} />
            </div>
          </section>

          {/* 5. Recent Orders Table (Requirement 4 & 8) */}
          <section aria-label="Recent Manufacturing Orders">
            <OrdersTable
              orders={orders}
              error={error}
              searchQuery={searchQuery}
              selectedFilter={statusFilter}
              onFilterChange={setStatusFilter}
              onSelectOrder={(order) => {
                showToast(`Viewing details for ${order.poNumber} (${order.style})`);
              }}
            />
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200/80 bg-white/60 py-4 px-6 text-center text-xs text-slate-500">
          <p>© 2026 KnitTrack Production OS. All factory lines operational.</p>
        </footer>
      </div>

      {/* 7. Quick Action: Create New Order Modal */}
      <CreateOrderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onAddOrder={handleAddOrder}
        buyers={buyers}
        buyerOptionsError={buyerOptionsError}
      />

      {/* Floating Feedback Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-xl border border-slate-800 flex items-center gap-2.5 animate-bounce-subtle">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
