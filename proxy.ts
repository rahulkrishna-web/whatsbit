import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // We only want to intercept POST requests that are NOT going to our /api/ routes
  if (request.method === "POST" && !request.nextUrl.pathname.startsWith('/api')) {
    const url = request.nextUrl.clone();
    
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const params = new URLSearchParams();
        formData.forEach((value, key) => {
          if (typeof value === "string") {
            params.append(key, value);
          }
        });
        url.search = params.toString();
      } else {
        const text = await request.text();
        url.searchParams.set("raw_body", text.substring(0, 200));
      }
    } catch (e: any) {
      console.error("Proxy body parse error:", e);
      url.searchParams.set("proxy_error", e.message || "unknown");
    }
    
    // 303 See Other is specifically meant to convert POST to GET redirects
    return NextResponse.redirect(url, 303);
  }
  
  return NextResponse.next();
}

export const config = {
  // Run on all routes except next internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
