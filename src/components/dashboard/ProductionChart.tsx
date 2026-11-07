"use client";

import React, { useState } from "react";
import { DailyProductionStat } from "@/types/dashboard";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { TrendingUpIcon } from "@/components/icons/Icons";

interface ProductionChartProps {
  data: DailyProductionStat[];
}

export function ProductionChart({ data }: ProductionChartProps) {
  const [activeDay, setActiveDay] = useState<string | null>("Fri");

  // Chart dimensions & scaling
  const maxOutput = Math.max(...data.map((d) => Math.max(d.target, d.actual))) * 1.15;
  const chartHeight = 180;
  const selectedStat = data.find((d) => d.day === activeDay) || data[4];

  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <span>Production Output vs Target</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
              <TrendingUpIcon className="w-3.5 h-3.5" />
              +4.8% vs last week
            </span>
          </div>
        }
        subtitle="Daily garment units completed across all manufacturing floors"
        action={
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-600" />
              <span className="text-slate-600 font-medium">Actual</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-300" />
              <span className="text-slate-600 font-medium">Target</span>
            </div>
          </div>
        }
      />

      <CardContent>
        {/* Main Bar Chart Container */}
        <div className="h-48 w-full flex items-end justify-between gap-2 sm:gap-4 pt-6 px-2 border-b border-slate-100">
          {data.map((item) => {
            const actualHeight = Math.round((item.actual / maxOutput) * chartHeight);
            const targetHeight = Math.round((item.target / maxOutput) * chartHeight);
            const isSelected = activeDay === item.day;
            const isExceeded = item.actual >= item.target;

            return (
              <div
                key={item.day}
                onMouseEnter={() => setActiveDay(item.day)}
                onClick={() => setActiveDay(item.day)}
                className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
              >
                {/* Floating tooltip on active */}
                <div
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded mb-1 transition-all duration-200 ${
                    isSelected
                      ? "bg-slate-900 text-white shadow-sm opacity-100 scale-100"
                      : "opacity-0 group-hover:opacity-100 text-slate-700 bg-slate-100"
                  }`}
                >
                  {item.actual.toLocaleString()}
                </div>

                {/* Bars column */}
                <div className="w-full max-w-[40px] flex items-end justify-center gap-1 h-[140px]">
                  {/* Target Bar (Ghost) */}
                  <div
                    className="w-1/2 bg-slate-200/80 rounded-t transition-all group-hover:bg-slate-300"
                    style={{ height: `${targetHeight}px` }}
                    title={`Target: ${item.target.toLocaleString()}`}
                  />

                  {/* Actual Bar */}
                  <div
                    className={`w-1/2 rounded-t transition-all ${
                      isSelected
                        ? "bg-blue-600 shadow-md shadow-blue-500/30"
                        : isExceeded
                        ? "bg-teal-500 group-hover:bg-teal-600"
                        : "bg-blue-500 group-hover:bg-blue-600"
                    }`}
                    style={{ height: `${actualHeight}px` }}
                    title={`Actual: ${item.actual.toLocaleString()}`}
                  />
                </div>

                {/* Day Label */}
                <span
                  className={`mt-2 text-xs font-semibold transition-colors ${
                    isSelected ? "text-blue-600 font-bold" : "text-slate-500 group-hover:text-slate-800"
                  }`}
                >
                  {item.day}
                </span>
              </div>
            );
          })}
        </div>

        {/* Selected Day Stage Breakdown Detail */}
        <div className="mt-4 pt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200/60 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px] font-medium">Selected Day</span>
            <span className="font-bold text-slate-800 text-sm">
              {selectedStat.day} Focus
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px] font-medium">Cutting Department</span>
            <span className="font-semibold text-slate-700">
              {selectedStat.cutting.toLocaleString()} pcs
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px] font-medium">Sewing Lines</span>
            <span className="font-semibold text-slate-700">
              {selectedStat.sewing.toLocaleString()} pcs
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px] font-medium">Finishing & Steam</span>
            <span className="font-semibold text-teal-700">
              {selectedStat.finishing.toLocaleString()} pcs
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
