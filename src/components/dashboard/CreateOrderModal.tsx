"use client";

import React, { useState } from "react";
import { OrderItem } from "@/types/dashboard";
import { CloseIcon, PlusIcon } from "@/components/icons/Icons";

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddOrder: (order: OrderItem) => void;
}

export function CreateOrderModal({
  isOpen,
  onClose,
  onAddOrder,
}: CreateOrderModalProps) {
  const [poNumber, setPoNumber] = useState("");
  const [client, setClient] = useState("");
  const [style, setStyle] = useState("");
  const [orderQuantity, setOrderQuantity] = useState<number>(10000);
  const [currentStage, setCurrentStage] = useState<OrderItem["currentStage"]>("Knitting");
  const [deliveryDate, setDeliveryDate] = useState("Nov 28, 2026");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newOrder: OrderItem = {
      id: `ord-${Date.now()}`,
      poNumber: poNumber.trim() || `PO-${Math.floor(10000 + Math.random() * 90000)}`,
      client: client.trim() || "Company Global",
      style: style.trim() || "Custom Knitted Garment",
      orderQuantity: Number(orderQuantity) || 5000,
      completedQuantity: 0,
      status: "green",
      statusLabel: "On Track",
      currentStage: currentStage,
      deliveryDate: deliveryDate,
    };

    onAddOrder(newOrder);
    onClose();

    // Reset fields
    setPoNumber("");
    setClient("");
    setStyle("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60">
              <PlusIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Create New Production Order</h3>
              <p className="text-xs text-slate-500">Initiate fabric scheduling and line allocation</p>
            </div>
          </div>

          <button
            suppressHydrationWarning
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Purchase Order (PO) #
              </label>
              <input
                suppressHydrationWarning
                type="text"
                required
                placeholder="e.g. E-PO-99104"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Buyer / Company
              </label>
              <input
                suppressHydrationWarning
                type="text"
                required
                placeholder="e.g. Company E (Retailer)"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Garment Style / Description
            </label>
            <input
              suppressHydrationWarning
              type="text"
              required
              placeholder="e.g. Organic Cotton Henley Long-Sleeve"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Total Pieces
              </label>
              <input
                suppressHydrationWarning
                type="number"
                min={100}
                step={50}
                required
                value={orderQuantity}
                onChange={(e) => setOrderQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Starting Stage
              </label>
              <select
                suppressHydrationWarning
                value={currentStage}
                onChange={(e) => setCurrentStage(e.target.value as OrderItem["currentStage"])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              >
                <option value="Knitting">Knitting</option>
                <option value="Dyeing">Dyeing</option>
                <option value="Cutting">Cutting</option>
                <option value="Sewing">Sewing</option>
                <option value="Finishing">Finishing</option>
                <option value="Quality Check">Quality Check</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Ship Date
              </label>
              <input
                suppressHydrationWarning
                type="text"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              suppressHydrationWarning
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              suppressHydrationWarning
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 rounded-lg shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
            >
              Confirm Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
