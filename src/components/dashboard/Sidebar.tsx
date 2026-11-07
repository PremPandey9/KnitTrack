"use client";

import React from "react";
import {
  KnitTrackLogo,
  DashboardIcon,
  OrdersIcon,
  ProductionIcon,
  DelayAlertIcon,
  ReportsIcon,
  SettingsIcon,
  CloseIcon,
} from "@/components/icons/Icons";

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
    { id: "orders", label: "Orders", icon: OrdersIcon, badge: "24" },
    { id: "production", label: "Production Tracking", icon: ProductionIcon },
    { id: "delays", label: "Delay Alerts", icon: DelayAlertIcon, badge: "3", badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
    { id: "reports", label: "Reports", icon: ReportsIcon },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/70 z-40 lg:hidden backdrop-blur-xs transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Container (Dark Navy #0B132B / slate-900) */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#0A1128] text-slate-200 flex flex-col border-r border-slate-800/80 shadow-2xl transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header with KnitTrack Logo */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/70">
          <div className="flex items-center gap-3">
            <KnitTrackLogo className="w-8 h-8 drop-shadow-md" />
            <div>
              <span className="font-bold text-lg text-white tracking-tight flex items-center gap-1.5">
                KnitTrack
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 font-semibold tracking-wider">
                  PRO
                </span>
              </span>
              <p className="text-[11px] text-slate-400 font-medium">Textile Operations</p>
            </div>
          </div>

          {/* Close button for mobile */}
          <button
            suppressHydrationWarning
            onClick={onCloseMobile}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 lg:hidden transition-colors"
            aria-label="Close sidebar"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider uppercase text-slate-400">
            Operations
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                suppressHydrationWarning
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                  isActive
                    ? "bg-blue-600/20 text-white border border-blue-500/30 shadow-xs shadow-blue-500/10"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-5 h-5 transition-colors ${
                      isActive ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                      item.badgeColor ||
                      (isActive
                        ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                        : "bg-slate-800 text-slate-300 border-slate-700")
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Shift Status Widget */}
        <div className="p-3 mx-3 mb-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400 font-medium">Floor Shift A</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active
            </span>
          </div>
          <div className="flex justify-between text-slate-300 font-medium">
            <span>Daily Output</span>
            <span className="text-teal-400 font-semibold">5,650 / 5,500 pcs</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-teal-400 h-full rounded-full" style={{ width: "94%" }} />
          </div>
        </div>

        {/* User Profile Mini Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-[#080d1f] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center font-bold text-white text-xs shadow-xs">
              PK
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-white leading-tight">Prem Kumar</p>
              <p className="text-[11px] text-slate-400">Plant Supervisor</p>
            </div>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-500/20" title="Online" />
        </div>
      </aside>
    </>
  );
}
