import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Bitrix24 sends POST requests containing authorization data in the body
  if (request.method === "POST") {
    try {
      const formData = await request.formData();
      const params = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      const url = request.nextUrl.clone();
      url.search = params.toString();
      // Redirect using status 303 (See Other) to convert POST to GET request
      return NextResponse.redirect(url, 303);
    } catch (e) {
      console.error("Failed to parse POST body in proxy", e);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
