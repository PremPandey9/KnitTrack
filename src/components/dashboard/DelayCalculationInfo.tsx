import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { DelayAlertIcon, CheckCircleIcon, ClockIcon } from "@/components/icons/Icons";

const steps = [
  { icon: CheckCircleIcon, title: "Finished goods only", detail: "Intermediate-stage throughput is excluded from the pace estimate." },
  { icon: ClockIcon, title: "14 calendar days", detail: "Final-stage daily quantities are summed, then divided by 14." },
  { icon: DelayAlertIcon, title: "Compare required pace", detail: "Remaining finished quantity is divided by calendar days through ex-factory." },
];

export function DelayCalculationInfo() {
  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader title="Finished Goods Pace" subtitle="Delay estimates use recorded final-stage output and order data." />
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, detail }) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Icon className="h-4 w-4 text-blue-600" />{title}</div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{detail}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
