import React from "react";
import { OrderStatus } from "@/types/dashboard";

interface ProgressBarProps {
  current: number;
  total: number;
  status?: OrderStatus;
  showLabels?: boolean;
  className?: string;
}

export function ProgressBar({
  current,
  total,
  status = "green",
  showLabels = false,
  className = "",
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((current / (total || 1)) * 100)));

  const barColor = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
  }[status];

  return (
    <div className={`w-full ${className}`}>
      {showLabels && (
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="font-medium text-slate-700">
            {current.toLocaleString()} / {total.toLocaleString()} pcs
          </span>
          <span className="font-semibold text-slate-900">{percentage}%</span>
        </div>
      )}
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/60">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
