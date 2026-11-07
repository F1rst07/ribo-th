import { isSameRequestOrigin, unoqHost } from "@/lib/unoqEndpoint";

const MAX_IMAGE_LENGTH = 1_500_000;

function visionHostAllowed(hostname: string): boolean {
  if (process.env.RIBO_DEVICE_MODE === "true") return true;
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  if (hostname === "ribo-th.vercel.app" || hostname.endsWith(".vercel.app")) return true;
  return process.env.NODE_ENV === "development";
}

export async function POST(request: Request) {
  const host = new URL(request.url).hostname;
  if (!visionHostAllowed(host)) {
    return Response.json({ error: "Vision proxy not enabled for this host" }, { status: 403 });
  }
  if (!isSameRequestOrigin(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_IMAGE_LENGTH) return Response.json({ error: "Image too large" }, { status: 413 });
  const image = await request.text();
  if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=\r\n]+$/.test(image)) {
    return Response.json({ error: "Invalid image" }, { status: 400 });
  }

  try {
    const enableTrash = request.headers.get("X-Enable-Trash") ?? "1";
    const enableOil = request.headers.get("X-Enable-Oil") ?? "1";
    const onDevice = process.env.RIBO_DEVICE_MODE === "true";
    const useMacAi = process.env.RIBO_MAC_AI === "true";
    const boardHost = unoqHost(request.headers.get("X-UNOQ-IP") || process.env.NEXT_PUBLIC_UNOQ_IP || "172.20.10.3");
    if (!onDevice && !useMacAi && ["localhost", "127.0.0.1"].includes(boardHost)) {
      return Response.json({ error: "Choose the UNO Q network address" }, { status: 400 });
    }
    // Local validation can run the full-precision PyTorch models on the Mac.
    // Device deployments and the default desktop mode continue using UNO Q.
    const backend = onDevice || useMacAi
      ? "http://127.0.0.1:8000/detect"
      : `http://${boardHost}:3000/api/vision`;
    const response = await fetch(backend, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Enable-Trash": enableTrash,
        "X-Enable-Oil": enableOil,
      },
      body: image,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      cache: "no-store",
    });
    if (response.status === 429) {
      return Response.json({ error: "AI is processing another frame; retry with a fresh frame" },
        { status: 429, headers: { "Retry-After": "1" } });
    }
    if (!response.ok) {
      return Response.json({ error: `Local AI request failed (${response.status})` }, { status: 502 });
    }
    const result = await response.json();
    if (!Array.isArray(result.predictions) || result.meta?.source !== "local" ||
        typeof result.meta?.oil_auto_ready !== "boolean" || typeof result.meta?.model !== "string") {
      throw new Error("Unexpected inference service; check the UNO Q deployment");
    }
    console.info(
      `[vision] source=${result.meta?.source ?? "unknown"} ` +
      `frame=${result.meta?.frame_id ?? "?"} detections=${result.predictions.length} fps=${result.meta?.fps ?? 0}`
    );
    return Response.json(
      { ...result, meta: { ...result.meta, model: "on-device vision" } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "AI service unavailable or returned an incompatible response" }, { status: 502 });
  }
}
