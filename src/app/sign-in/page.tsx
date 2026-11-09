import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/SignInForm";
import { getHomePathForRole, getProfile } from "@/lib/supabase/auth";

export const instant = false;

export default async function SignInPage() {
  const result = await getProfile();
  if (result.status === "authenticated") redirect(getHomePathForRole(result.profile.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-7">
          <p className="text-sm font-semibold tracking-wide text-blue-700">KNITTRACK</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Sign in to your account</h1>
          <p className="mt-2 text-sm text-slate-600">Use the email and password provided by your KnitTrack administrator.</p>
        </div>
        {result.status !== "unauthenticated" && (
          <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your account needs attention ({result.status.replaceAll("-", " ")}). Ask your administrator to check your KnitTrack profile.
          </p>
        )}
        <SignInForm />
      </section>
    </main>
  );
}
