import React from "react";
import { MetricSummary } from "@/types/dashboard";
import {
  OrdersIcon,
  CheckCircleIcon,
  DelayAlertIcon,
  ClockIcon,
} from "@/components/icons/Icons";

interface MetricCardsProps {
  metrics: MetricSummary;
  selectedFilter: string;
  onFilterChange: (status: "all" | "green" | "amber" | "red") => void;
}

export function MetricCards({
  metrics,
  selectedFilter,
  onFilterChange,
}: MetricCardsProps) {
  const cards = [
    {
      id: "all",
      title: "Total Orders",
      value: metrics.totalOrders,
      subtitle: "Active manufacturing contracts",
      accent: "text-blue-600 bg-blue-50 border-blue-200",
      icon: OrdersIcon,
      badgeText: "+3 this week",
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
      filterValue: "all" as const,
      borderHover: "hover:border-blue-400",
    },
    {
      id: "green",
      title: "On Track",
      value: metrics.onTrack,
      subtitle: "Meeting planned line Takt time",
      accent: "text-emerald-600 bg-emerald-50 border-emerald-200",
      icon: CheckCircleIcon,
      badgeText: "66.7% on schedule",
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      filterValue: "green" as const,
      borderHover: "hover:border-emerald-400",
    },
    {
      id: "amber",
      title: "At Risk",
      value: metrics.atRisk,
      subtitle: "Potential delay within 48-72h",
      accent: "text-amber-600 bg-amber-50 border-amber-200",
      icon: ClockIcon,
      badgeText: "Requires line check",
      badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
      filterValue: "amber" as const,
      borderHover: "hover:border-amber-400",
    },
    {
      id: "red",
      title: "Delayed",
      value: metrics.delayed,
      subtitle: "Critical process bottleneck",
      accent: "text-rose-600 bg-rose-50 border-rose-200",
      icon: DelayAlertIcon,
      badgeText: "Action required",
      badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
      filterValue: "red" as const,
      borderHover: "hover:border-rose-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = selectedFilter === card.filterValue;

        return (
          <button
            suppressHydrationWarning
            key={card.id}
            type="button"
            onClick={() => onFilterChange(card.filterValue)}
            className={`w-full text-left bg-white rounded-xl p-5 border transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
              isSelected
                ? "border-blue-500 ring-2 ring-blue-500/20 shadow-md"
                : `border-slate-200/90 ${card.borderHover}`
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {card.title}
              </span>
              <div className={`p-2 rounded-lg border ${card.accent}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {card.value}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${card.badgeColor}`}>
                {card.badgeText}
              </span>
            </div>

            <p className="mt-2 text-xs text-slate-500 font-medium">
              {card.subtitle}
            </p>
          </button>
        );
      })}
    </div>
  );
}
