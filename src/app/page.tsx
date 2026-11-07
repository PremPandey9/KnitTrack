"use client";

import React, { useState } from "react";
import { OrderItem } from "@/types/dashboard";
import {
  METRICS_DATA,
  RECENT_ORDERS_DATA,
  UPCOMING_DEADLINES_DATA,
  PRODUCTION_CHART_DATA,
} from "@/lib/mockData";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { ProductionChart } from "@/components/dashboard/ProductionChart";
import { OrdersTable } from "@/components/dashboard/OrdersTable";
import { UpcomingDeadlines } from "@/components/dashboard/UpcomingDeadlines";
import { CreateOrderModal } from "@/components/dashboard/CreateOrderModal";

export default function DashboardPage() {
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "green" | "amber" | "red">("all");

  const [orders, setOrders] = useState<OrderItem[]>(RECENT_ORDERS_DATA);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Compute live counts if new orders are added
  const metrics = {
    ...METRICS_DATA,
    totalOrders: orders.length + 19, // realistic active contracts buffer
    onTrack: orders.filter((o) => o.status === "green").length + 13,
    atRisk: orders.filter((o) => o.status === "amber").length + 4,
    delayed: orders.filter((o) => o.status === "red").length + 2,
  };

  const handleAddOrder = (newOrder: OrderItem) => {
    setOrders([newOrder, ...orders]);
    showToast(`Order ${newOrder.poNumber} created successfully!`);
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
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          if (tab !== "dashboard") {
            showToast(`Switched to "${tab.charAt(0).toUpperCase() + tab.slice(1)}" view`);
          }
        }}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area (Offset by Sidebar on Desktop) */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* 2. Top Navigation Header */}
        <Header
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenCreateOrder={() => setIsCreateModalOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Dashboard Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
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

          {/* 3. Four Overview Metric Cards */}
          <section aria-label="Key Performance Metrics">
            <MetricCards
              metrics={metrics}
              selectedFilter={statusFilter}
              onFilterChange={setStatusFilter}
            />
          </section>

          {/* 4. Production Chart & 6. Upcoming Deadlines Grid */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {/* 4. Production Overview Chart (takes 2 columns on desktop) */}
            <ProductionChart data={PRODUCTION_CHART_DATA} />

            {/* 6. Upcoming Deadlines Section (takes 1 column on desktop) */}
            <div className="col-span-1">
              <UpcomingDeadlines deadlines={UPCOMING_DEADLINES_DATA} />
            </div>
          </section>

          {/* 5. Recent Orders Table */}
          <section aria-label="Recent Manufacturing Orders">
            <OrdersTable
              orders={orders}
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
