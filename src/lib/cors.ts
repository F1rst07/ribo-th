import { NextRequest, NextResponse } from "next/server";

export function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") return origin;
  if (origin === "https://ribo-th.vercel.app") return origin;
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return origin;
  if (/^http:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return origin;
  if (/^http:\/\/[\w.-]+\.local(:\d+)?$/.test(origin)) return origin;
  return null;
}

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type, X-Enable-Trash, X-Enable-Oil, X-UNOQ-IP";

export function corsHeadersForRequest(request: Request): HeadersInit {
  const allow = allowedCorsOrigin(request.headers.get("origin"));
  if (!allow) return {};
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Private-Network": "true",
  };
}

export function corsPreflightResponse(request: NextRequest): NextResponse {
  const allowOrigin = allowedCorsOrigin(request.headers.get("origin"));
  if (!allowOrigin) return new NextResponse(null, { status: 204 });
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS,
      "Access-Control-Allow-Private-Network": "true",
    },
  });
}

export function jsonWithCors(
  request: NextRequest,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(corsHeadersForRequest(request))) {
    headers.set(k, String(v));
  }
  return NextResponse.json(data, { ...init, headers });
}

export function jsonResponseWithCors(
  request: Request,
  data: unknown,
  init?: ResponseInit
): Response {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(corsHeadersForRequest(request))) {
    headers.set(k, String(v));
  }
  return Response.json(data, { ...init, headers });
}

export function withCors(request: NextRequest, response: Response): Response {
  const cors = corsHeadersForRequest(request);
  if (!Object.keys(cors).length) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, String(v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
