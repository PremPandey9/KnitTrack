import { Badge } from "@/components/ui/Badge";
import { DelayRiskResult, delayRiskTone } from "@/lib/delay-risk";

function formatRate(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} pcs/day`;
}

export function DelayRiskSummary({ risk, compact = false }: { risk: DelayRiskResult; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2" : "rounded-lg border border-slate-200 bg-white p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">Delay risk</span>
        <Badge status={delayRiskTone(risk.status)} size="sm">{risk.status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 sm:grid-cols-4">
        <span>Remaining<strong className="block text-slate-900">{risk.remainingQuantity === null ? "—" : `${risk.remainingQuantity.toLocaleString()} pcs`}</strong></span>
        <span>Days left<strong className="block text-slate-900">{risk.daysRemaining === null ? "—" : risk.daysRemaining}</strong></span>
        <span>Observed<strong className="block text-slate-900">{formatRate(risk.observedDailyOutput)}</strong></span>
        <span>Required<strong className="block text-slate-900">{formatRate(risk.requiredDailyOutput)}</strong></span>
      </div>
      {risk.reason && <p className="text-[11px] leading-4 text-slate-500">{risk.reason}</p>}
    </div>
  );
}
