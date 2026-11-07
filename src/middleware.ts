import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") return origin;
  if (origin === "https://ribo-th.vercel.app") return origin;
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return origin;
  if (/^http:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const api =
    pathname.startsWith("/api/arduino") || pathname === "/api/vision";
  if (!api) return NextResponse.next();

  const origin = request.headers.get("origin");
  const allowOrigin = allowedCorsOrigin(origin);

  if (request.method === "OPTIONS") {
    if (!allowOrigin) return new NextResponse(null, { status: 204 });
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, X-Enable-Trash, X-Enable-Oil, X-UNOQ-IP",
        "Access-Control-Allow-Private-Network": "true",
      },
    });
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
