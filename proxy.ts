import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/** Refreshes Supabase's cookie session and keeps anonymous requests off app pages. */
export async function proxy(request: NextRequest) {
  const isPublicPage = ["/sign-in", "/access-denied"].includes(request.nextUrl.pathname);
  if (isPublicPage && (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL("/access-denied?reason=configuration", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const isSignInPage = request.nextUrl.pathname === "/sign-in";

  if (!data.user && !isSignInPage) {
    const redirectUrl = new URL("/sign-in", request.url);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (data.user) {
    const pathname = request.nextUrl.pathname;
    const isSupervisorAllowedPath =
      pathname === "/production-tracking" ||
      pathname === "/sign-in" ||
      pathname === "/access-denied";

    if (!isSupervisorAllowedPath) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profile?.role === "supervisor") {
        const redirectResponse = NextResponse.redirect(new URL("/production-tracking", request.url));
        response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
        return redirectResponse;
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
