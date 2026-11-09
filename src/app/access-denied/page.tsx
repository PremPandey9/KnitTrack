import Link from "next/link";

const messages: Record<string, string> = {
  "missing-profile": "Your login does not have a KnitTrack profile yet.",
  "invalid-role": "Your profile has an invalid role or is missing a buyer assignment.",
  "profile-error": "KnitTrack could not read your profile. Check the profiles table permissions.",
  permission: "Your role does not have permission to open this page or perform this action.",
  configuration: "Supabase authentication is not configured for this application.",
  assignment: "Supervisor order assignment is not configured in the application yet. No order data was loaded.",
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = messages[reason || ""] || "Your account cannot access this application.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Access unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">Ask your administrator to verify your Supabase Auth account and matching profile before trying again.</p>
        <Link href="/sign-in" className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Return to sign in</Link>
      </section>
    </main>
  );
}
