"use client";

import React from "react";
import {
  MenuIcon,
  SearchIcon,
  BellIcon,
  PlusIcon,
} from "@/components/icons/Icons";
import { signOutAction } from "@/app/actions/auth";
import { AppRole } from "@/lib/supabase/auth";

interface HeaderProps {
  fullName: string;
  role: AppRole;
  canCreateOrder: boolean;
  title?: string;
  subtitle?: string;
  showSearch?: boolean;
  showLiveFeed?: boolean;
  showNotifications?: boolean;
  onOpenMobileMenu: () => void;
  onOpenCreateOrder: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function Header({
  fullName,
  role,
  canCreateOrder,
  title = "Production Dashboard",
  subtitle = "Real-time tracking across knitting, dyeing, cutting & stitching units",
  showSearch = true,
  showLiveFeed = true,
  showNotifications = true,
  onOpenMobileMenu,
  onOpenCreateOrder,
  searchQuery,
  onSearchChange,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {/* Left: Hamburger (mobile) + Page Title */}
      <div className="flex items-center gap-3">
        <button
          suppressHydrationWarning
          onClick={onOpenMobileMenu}
          className="p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 lg:hidden transition-colors"
          aria-label="Open sidebar menu"
        >
          <MenuIcon className="w-5 h-5" />
        </button>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              {title}
            </h1>
            {showLiveFeed && <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Live Factory Feed
            </span>}
          </div>
          <p className="text-xs text-slate-500 hidden sm:block">
            {subtitle}
          </p>
        </div>
      </div>

      {/* Right: Search, Notifications, Create Order CTA, User Avatar */}
      <div className="flex items-center gap-2 sm:gap-3.5">
        {/* Search Field */}
        {showSearch && <div className="relative hidden md:block w-48 lg:w-64">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <SearchIcon className="w-4 h-4" />
          </div>
          <input
            suppressHydrationWarning
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search PO, style, company..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>}

        {/* Quick Action: Create New Order */}
        {canCreateOrder && <button
          suppressHydrationWarning
          onClick={onOpenCreateOrder}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-sm shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          <span className="hidden xs:inline sm:inline">Create Order</span>
        </button>}

        {/* Notifications Icon with Badge */}
        {showNotifications && <button
          suppressHydrationWarning
          className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          aria-label="View notifications"
        >
          <BellIcon className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
        </button>}

        {/* Divider */}
        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        {/* User Profile Menu */}
        <div className="flex items-center gap-2 pl-1">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-semibold text-xs flex items-center justify-center ring-2 ring-blue-500/20 shadow-xs">
            PK
          </div>
          <div className="hidden xl:block text-left">
            <span className="block text-xs font-semibold text-slate-900 leading-none">
              {fullName}
            </span>
            <span className="text-[10px] capitalize text-slate-500 font-medium">{role}</span>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="ml-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
