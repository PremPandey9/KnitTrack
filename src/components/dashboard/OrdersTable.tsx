"use client";

import React, { useState } from "react";
import { OrderItem } from "@/types/dashboard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EyeIcon } from "@/components/icons/Icons";

interface OrdersTableProps {
  orders: OrderItem[];
  searchQuery?: string;
  selectedFilter: string;
  onFilterChange: (status: "all" | "green" | "amber" | "red") => void;
  onSelectOrder?: (order: OrderItem) => void;
}

export function OrdersTable({
  orders,
  searchQuery = "",
  selectedFilter,
  onFilterChange,
  onSelectOrder,
}: OrdersTableProps) {
  const [selectedPo, setSelectedPo] = useState<string | null>(null);

  // Filter based on status filter and search query
  const filteredOrders = orders.filter((order) => {
    const matchesFilter =
      selectedFilter === "all" ? true : order.status === selectedFilter;

    const matchesSearch =
      searchQuery.trim() === ""
        ? true
        : order.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
          order.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
          order.style.toLowerCase().includes(searchQuery.toLowerCase()) ||
          order.currentStage.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <span>Recent Orders</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200">
              {filteredOrders.length} showing
            </span>
          </div>
        }
        subtitle="Live production batches and shop floor progress"
        action={
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200/70 text-xs">
            {(["all", "green", "amber", "red"] as const).map((filterKey) => {
              const label = {
                all: "All",
                green: "On Track",
                amber: "At Risk",
                red: "Delayed",
              }[filterKey];

              const isActive = selectedFilter === filterKey;

              return (
                <button
                  suppressHydrationWarning
                  key={filterKey}
                  onClick={() => onFilterChange(filterKey)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    isActive
                      ? "bg-white text-slate-900 shadow-xs font-semibold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        }
      />

      {/* Responsive Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 uppercase text-[11px] font-semibold tracking-wider border-b border-slate-200/80">
            <tr>
              <th className="py-3.5 px-4 sm:px-6">PO Number & Client</th>
              <th className="py-3.5 px-4">Garment Style</th>
              <th className="py-3.5 px-4">Production Progress</th>
              <th className="py-3.5 px-4">Current Stage</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">
                  <p className="text-sm font-medium">No production orders found matching criteria.</p>
                  <p className="text-xs text-slate-400 mt-1">Try resetting the filter or search query.</p>
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const isHighlighted = selectedPo === order.id;

                return (
                  <tr
                    key={order.id}
                    onClick={() => {
                      setSelectedPo(order.id);
                      if (onSelectOrder) onSelectOrder(order);
                    }}
                    className={`hover:bg-slate-50/90 transition-colors cursor-pointer ${
                      isHighlighted ? "bg-blue-50/40" : ""
                    }`}
                  >
                    {/* PO Number & Client */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>{order.poNumber}</span>
                      </div>
                      <div className="text-xs text-slate-500 font-medium">{order.client}</div>
                    </td>

                    {/* Garment Style */}
                    <td className="py-3.5 px-4">
                      <span className="font-medium text-slate-900 block">{order.style}</span>
                      <span className="text-[11px] text-slate-400">Due {order.deliveryDate}</span>
                    </td>

                    {/* Progress Bar & Quantities */}
                    <td className="py-3.5 px-4 min-w-[180px]">
                      <ProgressBar
                        current={order.completedQuantity}
                        total={order.orderQuantity}
                        status={order.status}
                        showLabels={true}
                      />
                    </td>

                    {/* Stage */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {order.currentStage}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <Badge status={order.status}>
                        {order.statusLabel}
                      </Badge>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        suppressHydrationWarning
                        type="button"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                        title="View order details"
                      >
                        <EyeIcon className="w-3.5 h-3.5" />
                        <span>Details</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
