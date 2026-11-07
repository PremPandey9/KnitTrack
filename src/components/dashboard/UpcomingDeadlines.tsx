import React from "react";
import { DeadlineItem } from "@/types/dashboard";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { ClockIcon, DelayAlertIcon, CheckCircleIcon } from "@/components/icons/Icons";

interface UpcomingDeadlinesProps {
  deadlines: DeadlineItem[];
}

export function UpcomingDeadlines({ deadlines }: UpcomingDeadlinesProps) {
  const urgencyBadges = {
    critical: "bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-500/10",
    warning: "bg-amber-50 text-amber-700 border-amber-200 ring-1 ring-amber-500/10",
    normal: "bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-500/10",
  };

  const urgencyIcons = {
    critical: DelayAlertIcon,
    warning: ClockIcon,
    normal: CheckCircleIcon,
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <span>Upcoming Delivery Deadlines</span>
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          </div>
        }
        subtitle="Critical ship dates and stage gates for the next 14 days"
      />

      <CardContent className="flex-1 space-y-3.5">
        {deadlines.map((item) => {
          const Icon = urgencyIcons[item.urgency];
          const badgeClass = urgencyBadges[item.urgency];

          return (
            <div
              key={item.id}
              className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{item.poNumber}</span>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs font-semibold text-slate-600">{item.client}</span>
                  </div>
                  <p className="text-xs text-slate-700 font-medium mt-0.5">{item.style}</p>
                </div>

                {/* Urgency Badge */}
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badgeClass} shrink-0`}
                >
                  <Icon className="w-3 h-3" />
                  {item.dueDate}
                </span>
              </div>

              {/* Stage & Bottleneck note */}
              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                <span className="text-slate-600 font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Stage: <strong className="text-slate-800">{item.stage}</strong>
                </span>

                {item.bottleneckReason && (
                  <span className="text-rose-600 font-medium text-[11px] bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                    ⚠ {item.bottleneckReason}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
