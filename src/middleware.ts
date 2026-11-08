import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { allowedCorsOrigin, corsPreflightResponse } from "@/lib/cors";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const api =
    pathname.startsWith("/api/arduino") || pathname === "/api/vision";
  if (!api) return NextResponse.next();

  const origin = request.headers.get("origin");
  const allowOrigin = allowedCorsOrigin(origin);

  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  const response = NextResponse.next();
  if (allowOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowOrigin);
    response.headers.set("Access-Control-Allow-Private-Network", "true");
  }
  return response;
}

export const config = {
  matcher: ["/api/arduino/:path*", "/api/vision"],
};
