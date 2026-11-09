"use client";

import React, { useState, useTransition } from "react";
import { Buyer, OrderItem } from "@/types/dashboard";
import { createOrderAction } from "@/app/actions/orders";
import { CloseIcon, PlusIcon } from "@/components/icons/Icons";
import PRODUCTION_STAGES from "@/lib/production-stages.json";

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddOrder: (order: OrderItem) => void;
  buyers: Buyer[];
  buyerOptionsError: string | null;
}

export function CreateOrderModal({
  isOpen,
  onClose,
  onAddOrder,
  buyers,
  buyerOptionsError,
}: CreateOrderModalProps) {
  const [poNumber, setPoNumber] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [styleName, setStyleName] = useState("");
  const [colour, setColour] = useState("");
  const [totalQuantity, setTotalQuantity] = useState("");
  const [currentStage, setCurrentStage] = useState("Knitting");
  const [finalProductionStage, setFinalProductionStage] = useState("Finishing");
  const [exFactoryDate, setExFactoryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  function resetForm() {
    setPoNumber("");
    setBuyerId("");
    setStyleName("");
    setColour("");
    setTotalQuantity("");
    setCurrentStage("Knitting");
    setFinalProductionStage("Finishing");
    setExFactoryDate("");
    setError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createOrderAction({
        poNumber,
        buyerId,
        styleName,
        colour,
        totalQuantity: Number(totalQuantity),
        currentStage,
        finalProductionStage,
        exFactoryDate,
      });

      if (!result.success || !result.order) {
        setError(result.error || "The order could not be saved.");
        return;
      }

      onAddOrder(result.order);
      resetForm();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-xs animate-fadeIn">
      <div className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-blue-200/60 bg-blue-50 p-2 text-blue-600"><PlusIcon className="h-4 w-4" /></div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Create New Production Order</h3>
              <p className="text-xs text-slate-500">Order details will be saved to Supabase.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isPending} aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Purchase Order (PO) number" htmlFor="create-po">
              <input id="create-po" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} required maxLength={100} autoComplete="off" placeholder="e.g. E-PO-99104" className={inputClass} />
            </Field>
            <Field label="Buyer company" htmlFor="create-buyer">
              <select id="create-buyer" value={buyerId} onChange={(event) => setBuyerId(event.target.value)} required disabled={Boolean(buyerOptionsError) || buyers.length === 0} className={inputClass}>
                <option value="">Select an existing buyer</option>
                {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}
              </select>
            </Field>
            <Field label="Style name" htmlFor="create-style">
              <input id="create-style" value={styleName} onChange={(event) => setStyleName(event.target.value)} required maxLength={200} placeholder="e.g. Cotton crew neck sweater" className={inputClass} />
            </Field>
            <Field label="Colour" htmlFor="create-colour">
              <input id="create-colour" value={colour} onChange={(event) => setColour(event.target.value)} required maxLength={100} placeholder="e.g. Navy" className={inputClass} />
            </Field>
            <Field label="Total quantity (pieces)" htmlFor="create-quantity">
              <input id="create-quantity" type="number" min={1} step={1} inputMode="numeric" value={totalQuantity} onChange={(event) => setTotalQuantity(event.target.value)} required placeholder="Enter a whole number" className={inputClass} />
            </Field>
            <Field label="Initial production stage" htmlFor="create-stage">
              <select id="create-stage" value={currentStage} onChange={(event) => setCurrentStage(event.target.value)} className={inputClass}>
                {PRODUCTION_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
            </Field>
            <Field label="Final production stage" htmlFor="create-final-stage">
              <select id="create-final-stage" value={finalProductionStage} onChange={(event) => setFinalProductionStage(event.target.value)} required className={inputClass}>
                {PRODUCTION_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
            </Field>
            <Field label="Ex-factory date" htmlFor="create-date">
              <input id="create-date" type="date" value={exFactoryDate} onChange={(event) => setExFactoryDate(event.target.value)} required className={inputClass} />
            </Field>
          </div>

          {buyerOptionsError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not load buyer companies: {buyerOptionsError}</p>}
          {!buyerOptionsError && buyers.length === 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No buyers are available to your account. Ask an administrator to check buyer access.</p>}
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isPending || buyers.length === 0 || Boolean(buyerOptionsError)} className="rounded-lg bg-gradient-to-r from-blue-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 transition-all hover:from-blue-700 hover:to-teal-700 disabled:cursor-wait disabled:opacity-60">
              {isPending ? "Saving order…" : "Save production order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-700">{label}</label>{children}</div>;
}
