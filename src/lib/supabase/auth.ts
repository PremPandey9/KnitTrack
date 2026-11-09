import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "merchandiser" | "supervisor" | "buyer";

export interface UserProfile {
  id: string;
  fullName: string;
  role: AppRole;
  buyerId: string | null;
}

export function getHomePathForRole(role: AppRole): string {
  if (role === "buyer") return "/buyer-dashboard";
  if (role === "supervisor") return "/production-tracking";
  return "/";
}

export type ProfileResult =
  | { status: "authenticated"; profile: UserProfile }
  | { status: "unauthenticated" }
  | { status: "missing-profile" }
  | { status: "invalid-role" }
  | { status: "profile-error" };

const APP_ROLES = new Set<AppRole>(["merchandiser", "supervisor", "buyer"]);

/** Always verify the user with Supabase Auth before trusting a profile row. */
export async function getProfile(): Promise<ProfileResult> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) return { status: "unauthenticated" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, buyer_id")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (error) return { status: "profile-error" };
  if (!data) return { status: "missing-profile" };

  const role = String(data.role || "").trim().toLowerCase() as AppRole;
  if (!APP_ROLES.has(role)) return { status: "invalid-role" };
  if (role === "buyer" && !data.buyer_id) return { status: "invalid-role" };

  return {
    status: "authenticated",
    profile: {
      id: data.id,
      fullName: data.full_name || "KnitTrack user",
      role,
      buyerId: data.buyer_id,
    },
  };
}

export async function requireProfile(): Promise<UserProfile> {
  const result = await getProfile();
  if (result.status === "authenticated") return result.profile;

  if (result.status === "unauthenticated") redirect("/sign-in");
  redirect(`/access-denied?reason=${result.status}`);
}

export async function requireRole(...roles: AppRole[]): Promise<UserProfile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/access-denied?reason=permission");
  return profile;
}
