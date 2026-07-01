import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const publicApiPrefixes = [
    "/api/inbound-email",
    "/api/jobs/deal-processing",
    "/api/jobs/email-routing",
    "/api/cron/cleanup",
    "/api/cron/reminders",
  ];
  if (publicApiPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    return response;
  }

  // Refresh session; gate everything except /login and static assets.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const role = profile?.role ?? null;
  const isTemplateEditor = role === "template_editor";
  const isTemplateDraftApi = request.nextUrl.pathname.startsWith("/api/template-drafts");

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = isTemplateEditor ? "/admin/templates" : "/";
    return NextResponse.redirect(url);
  }

  if (isTemplateEditor && !request.nextUrl.pathname.startsWith("/admin/templates") && !isTemplateDraftApi) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/admin/templates";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
