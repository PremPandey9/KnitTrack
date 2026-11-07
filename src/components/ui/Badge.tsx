import React from "react";
import { OrderStatus } from "@/types/dashboard";

interface BadgeProps {
  status?: OrderStatus | "blue" | "teal" | "neutral";
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}

export function Badge({
  status = "neutral",
  children,
  className = "",
  size = "md",
}: BadgeProps) {
  const sizeStyles = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

  const statusStyles: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200/80 ring-1 ring-emerald-500/10",
    amber: "bg-amber-50 text-amber-700 border-amber-200/80 ring-1 ring-amber-500/10",
    red: "bg-rose-50 text-rose-700 border-rose-200/80 ring-1 ring-rose-500/10",
    blue: "bg-blue-50 text-blue-700 border-blue-200/80 ring-1 ring-blue-500/10",
    teal: "bg-teal-50 text-teal-700 border-teal-200/80 ring-1 ring-teal-500/10",
    neutral: "bg-slate-100 text-slate-700 border-slate-200 ring-1 ring-slate-400/10",
  };

  const dotStyles: Record<string, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    blue: "bg-blue-500",
    teal: "bg-teal-500",
    neutral: "bg-slate-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border transition-colors ${sizeStyles} ${statusStyles[status] || statusStyles.neutral} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[status] || dotStyles.neutral}`} />
      {children}
    </span>
  );
}
