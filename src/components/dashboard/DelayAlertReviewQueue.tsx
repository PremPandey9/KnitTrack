"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDelayAlert, dismissDelayAlert } from "@/app/actions/delay-alerts";
import { Card, CardHeader } from "@/components/ui/Card";
import type { DelayAlertReviewItem } from "@/lib/supabase/delay-alerts";

function formatQuantity(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} pcs/day`;
}

function formatPace(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function AlertReviewCard({
  alert,
  onMessage,
}: {
  alert: DelayAlertReviewItem;
  onMessage: (message: string, kind: "success" | "error" | "conflict") => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dismissalReason, setDismissalReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const runDecision = (decision: "approved" | "dismissed") => {
    setLocalError(null);
    startTransition(async () => {
      const result = decision === "approved"
        ? await approveDelayAlert(alert.id, alert.snapshot)
        : await dismissDelayAlert(alert.id, alert.snapshot, dismissalReason);
      if (result.status === "success") {
        onMessage(result.message, "success");
        router.refresh();
      } else if (result.status === "conflict") {
        setLocalError(result.message);
        onMessage(result.message, "conflict");
        router.refresh();
      } else {
        setLocalError(result.message);
        onMessage(result.message, "error");
      }
    });
  };

  const submitDismissal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runDecision("dismissed");
  };

  const { snapshot } = alert;
  return (
    <article className="border-t border-slate-100 p-4 first:border-0 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-900">{alert.poNumber}</h4>
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">
              {snapshot.risk_level}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700">{alert.styleName} · {alert.buyerCompany}</p>
          <p className="mt-1 text-xs text-slate-500">
            Calculated {new Date(snapshot.calculated_at).toLocaleString()}
            {snapshot.final_production_stage ? ` · Final stage: ${snapshot.final_production_stage}` : " · Final stage not configured"}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {snapshot.days_remaining === null ? "Days remaining —" : `${snapshot.days_remaining} days remaining`}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
        <div><dt className="text-slate-500">Remaining</dt><dd className="mt-1 font-semibold text-slate-900">{formatQuantity(snapshot.remaining_quantity)} pcs</dd></div>
        <div><dt className="text-slate-500">Total / completed</dt><dd className="mt-1 font-semibold text-slate-900">{formatQuantity(snapshot.total_quantity)} / {formatQuantity(snapshot.completed_quantity)}</dd></div>
        <div><dt className="text-slate-500">Observed pace</dt><dd className="mt-1 font-semibold text-slate-900">{formatRate(snapshot.observed_daily_output)}</dd></div>
        <div><dt className="text-slate-500">Required pace</dt><dd className="mt-1 font-semibold text-slate-900">{formatRate(snapshot.required_daily_output)}</dd></div>
        <div><dt className="text-slate-500">Pace ratio</dt><dd className="mt-1 font-semibold text-slate-900">{formatPace(snapshot.pace_ratio)}</dd></div>
      </dl>

      <form className="mt-4 space-y-3" onSubmit={submitDismissal}>
        <div>
          <label htmlFor={`dismissal-${alert.id}`} className="mb-1 block text-xs font-medium text-slate-600">
            Dismissal reason <span className="font-normal text-slate-400">(optional, up to 2,000 characters)</span>
          </label>
          <textarea
            id={`dismissal-${alert.id}`}
            value={dismissalReason}
            onChange={(event) => setDismissalReason(Array.from(event.target.value).slice(0, 2000).join(""))}
            rows={2}
            disabled={isPending}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
            placeholder="Add context for the audit history"
          />
          <p className="mt-1 text-right text-[11px] text-slate-400">{Array.from(dismissalReason).length} / 2,000 characters</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Dismiss alert"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runDecision("approved")}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Approve alert"}
          </button>
        </div>
      </form>

      {localError && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{localError}</p>}
    </article>
  );
}

export function DelayAlertReviewQueue({ alerts, error }: { alerts: DelayAlertReviewItem[]; error: string | null }) {
  const [announcement, setAnnouncement] = useState<{ message: string; kind: "success" | "error" | "conflict" } | null>(null);

  return (
    <section id="delay-alert-review" aria-labelledby="delay-alert-review-title" className="scroll-mt-4">
      <Card className="overflow-hidden">
        <CardHeader
          title={<span id="delay-alert-review-title">Delay alert review</span>}
          subtitle="Approve or dismiss pending production-delay calculations before buyers can see them."
        />
        {announcement && (
          <div aria-live="polite" role={announcement.kind === "success" ? "status" : "alert"}
            className={`mx-4 mt-4 rounded-lg border p-3 text-sm sm:mx-5 ${announcement.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : announcement.kind === "conflict" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            {announcement.message}
          </div>
        )}
        {error ? (
          <div role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:m-5">{error}</div>
        ) : alerts.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">No pending delay alerts</p>
            <p className="mt-1 text-sm text-slate-500">New candidates will appear here for merchandiser review.</p>
          </div>
        ) : (
          <div>
            {alerts.map((alert) => (
              <AlertReviewCard key={alert.id} alert={alert} onMessage={(message, kind) => setAnnouncement({ message, kind })} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
