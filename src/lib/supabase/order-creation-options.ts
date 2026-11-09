import "server-only";

import { createClient } from "@/lib/supabase/server";
import { Buyer } from "@/types/dashboard";

export interface OrderCreationOptions {
  buyers: Buyer[];
  error: string | null;
}

/** Loads only buyers the signed-in merchandiser is allowed to see under RLS. */
export async function getOrderCreationOptions(): Promise<OrderCreationOptions> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("buyers")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) return { buyers: [], error: error.message };

    return {
      buyers: (data || []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        name: String(row.company_name || "Buyer"),
      })),
      error: null,
    };
  } catch (cause) {
    return {
      buyers: [],
      error: cause instanceof Error ? cause.message : "Could not load buyers.",
    };
  }
}
