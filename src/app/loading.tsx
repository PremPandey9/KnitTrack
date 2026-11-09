import React from "react";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-50 flex animate-pulse">
      {/* Sidebar Skeleton (matches #0A1128 styling) */}
      <div className="hidden lg:flex w-64 bg-[#0A1128] flex-col p-5 space-y-6 shrink-0">
        <div className="h-8 bg-slate-800 rounded-lg w-32" />
        <div className="space-y-3 pt-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-9 bg-slate-850 rounded-lg w-full bg-slate-800/60" />
          ))}
        </div>
      </div>

      {/* Main Content Area Skeleton */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Skeleton */}
        <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
          <div className="h-6 bg-slate-200 rounded w-48" />
          <div className="flex gap-3">
            <div className="h-9 bg-slate-100 rounded-lg w-40" />
            <div className="h-9 bg-slate-200 rounded-lg w-28" />
          </div>
        </div>

        {/* Content Skeleton */}
        <div className="p-6 space-y-6 max-w-7xl w-full mx-auto">
          {/* 4 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                <div className="h-4 bg-slate-200 rounded w-24" />
                <div className="h-8 bg-slate-300 rounded w-16" />
                <div className="h-3 bg-slate-100 rounded w-32" />
              </div>
            ))}
          </div>

          {/* Chart & Deadlines Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 h-64" />
            <div className="col-span-1 bg-white p-6 rounded-xl border border-slate-200 h-64" />
          </div>

          {/* Orders Table Skeleton */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 h-72" />
        </div>
      </div>
    </div>
  );
}
