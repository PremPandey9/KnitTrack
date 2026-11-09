"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserProfile } from "@/lib/supabase/auth";
import { ProductionOrder, ProductionUpdate } from "@/lib/supabase/production";
import { submitProductionUpdate } from "@/app/actions/production";
import { assignOrderSupervisorAction } from "@/app/actions/orders";
import { configureOrderFinalStageAction } from "@/app/actions/orders";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DelayRiskSummary } from "@/components/dashboard/DelayRiskSummary";
import PRODUCTION_STAGES from "@/lib/production-stages.json";

interface Props {
  profile: UserProfile;
  orders: ProductionOrder[];
  updates: ProductionUpdate[];
  availableSupervisors: Array<{ id: string; fullName: string }>;
  supervisorListError: string | null;
  orderError: string | null;
  updateError: string | null;
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ProductionTrackingClient({ profile, orders, updates, availableSupervisors, supervisorListError, orderError, updateError }: Props) {
  const router = useRouter();
  const [selectedOrderId, setSelectedOrderId] = useState(orders[0]?.id || "");
  const [stage, setStage] = useState(orders[0]?.currentStage || PRODUCTION_STAGES[0]);
  const [quantity, setQuantity] = useState("");
  const [updateDate, setUpdateDate] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [assignmentBusyOrderId, setAssignmentBusyOrderId] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<{ orderId: string; kind: "success" | "error"; text: string } | null>(null);
  const [finalStageDrafts, setFinalStageDrafts] = useState<Record<string, string>>({});
  const [finalStageBusyOrderId, setFinalStageBusyOrderId] = useState<string | null>(null);
  const [finalStageMessage, setFinalStageMessage] = useState<{ orderId: string; kind: "success" | "error"; text: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [, startFinalStageTransition] = useTransition();
  const stageOptions = [...new Set([
    ...PRODUCTION_STAGES,
    ...orders.map((order) => order.currentStage.trim()).filter(Boolean),
  ])].sort();

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || orders[0];
  const selectedUpdates = updates.filter((update) => update.orderId === selectedOrder?.id);

  function handleOrderChange(orderId: string) {
    setSelectedOrderId(orderId);
    const nextOrder = orders.find((order) => order.id === orderId);
    if (nextOrder) setStage(nextOrder.currentStage || PRODUCTION_STAGES[0]);
  }

  function handleSupervisorChange(orderId: string, supervisorId: string) {
    setAssignmentBusyOrderId(orderId);
    setAssignmentMessage(null);
    startTransition(async () => {
      const result = await assignOrderSupervisorAction(orderId, supervisorId || null);
      setAssignmentBusyOrderId(null);
      setAssignmentMessage(result.success
        ? { orderId, kind: "success", text: supervisorId ? "Supervisor assignment saved." : "Supervisor unassigned." }
        : { orderId, kind: "error", text: result.error || "Could not save supervisor assignment." });
      if (result.success) router.refresh();
    });
  }

  function handleFinalStageChange(orderId: string, finalStage: string) {
    if (!finalStage) return;
    setFinalStageDrafts((current) => ({ ...current, [orderId]: finalStage }));
    setFinalStageBusyOrderId(orderId);
    setFinalStageMessage(null);
    startFinalStageTransition(async () => {
      const result = await configureOrderFinalStageAction(orderId, finalStage);
      setFinalStageBusyOrderId(null);
      setFinalStageMessage(result.success
        ? { orderId, kind: "success", text: "Final production stage saved." }
        : { orderId, kind: "error", text: result.error || "Could not save the final production stage." });
      if (result.success) router.refresh();
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    if (!selectedOrder) {
      setFormError("There are no accessible orders to update.");
      return;
    }

    startTransition(async () => {
      const result = await submitProductionUpdate({
        orderId: selectedOrder.id,
        stage,
        quantityCompleted: Number(quantity),
        updateDate,
        issueNote,
      });
      if (!result.success) {
        setFormError(result.error || "The update could not be saved.");
        return;
      }
      setSuccessMessage("Production update saved.");
      setQuantity("");
      setIssueNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar
        fullName={profile.fullName}
        role={profile.role}
        currentTab="production"
        onSelectTab={() => undefined}
        isOpenMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Header
          fullName={profile.fullName}
          role={profile.role}
          canCreateOrder={false}
          title="Production Tracking"
          subtitle="Daily shop-floor progress and order updates."
          showSearch={false}
          showLiveFeed={false}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenCreateOrder={() => undefined}
          searchQuery=""
          onSearchChange={() => undefined}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 sm:p-6 lg:p-8">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Production Tracking</h2>
            <p className="mt-1 text-sm text-slate-500">Orders and daily output available to your account.</p>
          </div>

          {orderError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><strong>Could not load production orders.</strong><p className="mt-1">{orderError}</p></div>}
          {updateError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Update history is unavailable.</strong><p className="mt-1">{updateError}</p></div>}

          {orders.length === 0 && !orderError ? (
            <Card><CardContent className="py-14 text-center">
              <p className="font-semibold text-slate-800">No production orders assigned</p>
              <p className="mt-1 text-sm text-slate-500">Orders available to your account will appear here.</p>
            </CardContent></Card>
          ) : orders.length > 0 && (
            <>
              <section aria-label="Accessible production orders" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {orders.map((order) => {
                  const progress = order.totalQuantity > 0 ? Math.round((order.completedQuantity / order.totalQuantity) * 100) : 0;
                  return (
                    <article key={order.id} className={`rounded-xl border bg-white text-left shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition ${selectedOrder?.id === order.id ? "border-blue-500 ring-2 ring-blue-500/15" : "border-slate-200"}`}>
                      <button type="button" onClick={() => handleOrderChange(order.id)} aria-pressed={selectedOrder?.id === order.id} className="block w-full rounded-t-xl text-left transition hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
                        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{order.poNumber}</p><h3 className="mt-1 font-bold text-slate-900">{order.style}</h3><p className="mt-0.5 text-sm text-slate-600">{order.buyer} · {order.colour}</p></div>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">{order.currentStage}</span>
                      </div>
                      <div className="space-y-3 p-4 sm:p-5">
                        <ProgressBar current={order.completedQuantity} total={order.totalQuantity} showLabels />
                        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          <div><span className="block text-slate-500">Total</span><strong className="mt-0.5 block text-slate-800">{order.totalQuantity.toLocaleString()} pcs</strong></div>
                          <div><span className="block text-slate-500">Completed</span><strong className="mt-0.5 block text-slate-800">{order.completedQuantity.toLocaleString()} pcs</strong></div>
                          <div><span className="block text-slate-500">Remaining</span><strong className="mt-0.5 block text-slate-800">{order.remainingQuantity.toLocaleString()} pcs</strong></div>
                          <div><span className="block text-slate-500">Ex-factory</span><strong className="mt-0.5 block text-slate-800">{formatDate(order.exFactoryDate)}</strong></div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600"><span>Assigned supervisor</span><strong className="text-slate-800">{order.supervisorName}</strong><span>Final production stage</span><strong className="text-slate-800">{order.finalProductionStage || "Final stage not configured"}</strong><span className="sr-only">{progress}% completed</span></div>
                      </div>
                      </button>
                      <div className="px-4 pb-4 sm:px-5"><DelayRiskSummary risk={order.delayRisk} compact /></div>
                      {profile.role === "merchandiser" && <div className="border-t border-slate-100 px-4 pb-4 sm:px-5">
                        <label htmlFor={`supervisor-${order.id}`} className="mb-1 block text-xs font-semibold text-slate-700">Assign supervisor</label>
                        <select id={`supervisor-${order.id}`} value={order.supervisorId || ""} disabled={Boolean(assignmentBusyOrderId) || Boolean(supervisorListError)} onChange={(event) => handleSupervisorChange(order.id, event.target.value)} className={inputClass}>
                          <option value="">Unassigned</option>
                          {availableSupervisors.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
                        </select>
                        {assignmentBusyOrderId === order.id && <p role="status" className="mt-1 text-xs text-slate-500">Saving assignment...</p>}
                        {supervisorListError && <p role="alert" className="mt-1 text-xs text-rose-700">Could not load supervisors: {supervisorListError}</p>}
                        {!supervisorListError && availableSupervisors.length === 0 && <p className="mt-1 text-xs text-slate-500">No supervisor profiles are available.</p>}
                        {assignmentMessage?.orderId === order.id && <p role={assignmentMessage.kind === "error" ? "alert" : "status"} className={`mt-1 text-xs ${assignmentMessage.kind === "error" ? "text-rose-700" : "text-emerald-700"}`}>{assignmentMessage.text}</p>}
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <label htmlFor={`final-stage-${order.id}`} className="mb-1 block text-xs font-semibold text-slate-700">Final production stage</label>
                          <select id={`final-stage-${order.id}`} value={finalStageDrafts[order.id] ?? order.finalProductionStage ?? ""} disabled={finalStageBusyOrderId === order.id} onChange={(event) => handleFinalStageChange(order.id, event.target.value)} className={inputClass}>
                            <option value="" disabled>Final stage not configured</option>
                            {order.finalProductionStage && !PRODUCTION_STAGES.includes(order.finalProductionStage) && <option value={order.finalProductionStage}>{order.finalProductionStage}</option>}
                            {PRODUCTION_STAGES.map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                          {finalStageBusyOrderId === order.id && <p role="status" className="mt-1 text-xs text-slate-500">Saving final stage...</p>}
                          {finalStageMessage?.orderId === order.id && <p role={finalStageMessage.kind === "error" ? "alert" : "status"} className={`mt-1 text-xs ${finalStageMessage.kind === "error" ? "text-rose-700" : "text-emerald-700"}`}>{finalStageMessage.text}</p>}
                        </div>
                      </div>}
                    </article>
                  );
                })}
              </section>

              <Card>
                <CardHeader title="Daily Production Update" subtitle={selectedOrder ? `Update for ${selectedOrder.poNumber}` : "Select an order"} />
                <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                  <Field label={profile.role === "supervisor" ? "Assigned order" : "Production order"} htmlFor="production-order">
                    <select id="production-order" value={selectedOrderId} onChange={(event) => handleOrderChange(event.target.value)} required className={inputClass}>
                      {orders.map((order) => <option key={order.id} value={order.id}>{order.poNumber} · {order.style}</option>)}
                    </select>
                  </Field>
                  <Field label="Production stage" htmlFor="production-stage">
                    <input id="production-stage" list="production-stage-options" value={stage} onChange={(event) => setStage(event.target.value)} required maxLength={100} className={inputClass} placeholder="Choose or enter a stage" />
                    <datalist id="production-stage-options">
                      {stageOptions.map((value) => <option key={value} value={value} />)}
                    </datalist>
                  </Field>
                  <Field label="Quantity completed today" htmlFor="production-quantity">
                    <input id="production-quantity" type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required className={inputClass} placeholder="Whole number of pieces" />
                  </Field>
                  <Field label="Update date" htmlFor="production-date">
                    <input id="production-date" type="date" value={updateDate} onChange={(event) => setUpdateDate(event.target.value)} required className={inputClass} />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3"><label htmlFor="production-issue" className="mb-1 block text-xs font-semibold text-slate-700">Issue or delay note <span className="font-normal text-slate-500">(optional)</span></label><textarea id="production-issue" value={issueNote} onChange={(event) => setIssueNote(event.target.value)} rows={3} maxLength={2000} className={inputClass} placeholder="Describe any production issue or delay" /></div>
                  <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                    <label htmlFor="production-photo" className="block text-xs font-semibold text-slate-700">Production photo</label>
                    <input id="production-photo" type="file" accept="image/*" disabled className="mt-2 block w-full cursor-not-allowed text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-500" />
                    <p className="mt-1 text-xs">Photo upload unavailable: no Supabase Storage bucket is configured.</p>
                  </div>
                  {formError && <p role="alert" className="sm:col-span-2 lg:col-span-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</p>}
                  {successMessage && <p role="status" className="sm:col-span-2 lg:col-span-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{successMessage}</p>}
                  <div className="sm:col-span-2 lg:col-span-3 flex justify-end"><button type="submit" disabled={isPending || !selectedOrder} className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-blue-700 hover:to-teal-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto">{isPending ? "Saving update…" : "Save production update"}</button></div>
                </form>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader title="Production update history" subtitle={selectedOrder ? `Daily updates for ${selectedOrder.poNumber}` : "Select an order to view its update history"} />
                {selectedUpdates.length === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-500">{updateError ? "Update history could not be loaded." : "No production updates recorded for this order."}</div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-y border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 sm:px-5">Date</th><th className="px-4 py-3">PO</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3 text-right">Daily completed</th><th className="px-4 py-3">Supervisor</th><th className="px-4 py-3">Issue / attachment</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">{selectedUpdates.map((update) => <tr key={update.id} className="align-top"><td className="whitespace-nowrap px-4 py-3 sm:px-5">{formatDate(update.updateDate)}</td><td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{update.poNumber}</td><td className="px-4 py-3"><Badge status="blue">{update.stage}</Badge></td><td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{update.quantityCompleted.toLocaleString()} pcs</td><td className="px-4 py-3">{update.supervisorName}</td><td className="max-w-sm px-4 py-3"><span className="whitespace-pre-wrap break-words">{update.issueNote || "—"}</span>{update.photoUrl && <a href={update.photoUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs font-semibold text-blue-700 underline">View photo</a>}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-700">{label}</label>{children}</div>;
}
