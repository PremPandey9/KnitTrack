"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

export async function signInAction(
  _previousState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Sign-in failed. Check your email and password." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, buyer_id")
    .eq("id", signInData.user.id)
    .maybeSingle();

  if (profileError) {
    await supabase.auth.signOut();
    return { error: "KnitTrack could not verify your account profile. Ask your administrator to check your access." };
  }
  if (!profile) redirect("/access-denied?reason=missing-profile");

  const role = String(profile.role || "").trim().toLowerCase();
  if (!(["merchandiser", "supervisor", "buyer"] as string[]).includes(role)) {
    redirect("/access-denied?reason=invalid-role");
  }
  if (role === "buyer" && !profile.buyer_id) {
    redirect("/access-denied?reason=invalid-role");
  }

  revalidatePath("/", "layout");
  if (role === "buyer") redirect("/buyer-dashboard");
  if (role === "supervisor") redirect("/production-tracking");
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
