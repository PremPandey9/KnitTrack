import { DeadlineItem } from "@/types/dashboard";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { DelayRiskSummary } from "@/components/dashboard/DelayRiskSummary";

interface UpcomingDeadlinesProps {
  deadlines: DeadlineItem[];
}

export function UpcomingDeadlines({ deadlines }: UpcomingDeadlinesProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Delivery Pace Review" subtitle="Uses final-stage output history to estimate delivery risk." />
      <CardContent className="flex-1 space-y-3.5">
        {deadlines.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No orders are available for delay review.</div>
        ) : deadlines.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:border-slate-300 hover:bg-white">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{item.poNumber}</span>
                  <span className="text-xs font-semibold text-slate-600">{item.client}</span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-slate-700">{item.style}</p>
              </div>
              <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">{item.dueDate}</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">Current stage: <strong className="text-slate-800">{item.stage}</strong>{item.daysRemaining !== null ? ` · ${item.daysRemaining} calendar day${item.daysRemaining === 1 ? "" : "s"} remaining` : ""}</p>
            <div className="mt-3"><DelayRiskSummary risk={item.delayRisk} compact /></div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
