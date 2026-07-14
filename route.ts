export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proxy?url=<resolved-cdn-url>&filename=<name>
 *
 * Primary download relay. Public CORS proxies (corsproxy.io etc.) are now
 * unreliable for binary blobs outside localhost (403 / size limits), so we
 * fetch the resolved CDN location server-side and stream it straight to the
 * browser. Node's fetch transparently decodes any HTTP Content-Encoding, so
 * the client always receives a valid .rbxm.
 *
 * Used by the client as the primary download mirror; corsproxy.io remains a
 * secondary fallback (correct `?url=` format) for localhost development.
 */
const ALLOWED_HOST = /^https:\/\/([a-z0-9-]+\.)?rbxcdn\.com(\/|$)/i;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  const filename =
    searchParams.get("filename") || "AnimForge_download.rbxm";

  if (!target || !/^https:\/\//i.test(target)) {
    return new Response("Missing or invalid url param.", { status: 400 });
  }

  // Only mirror Roblox CDN hosts to avoid an open proxy.
  let targetHostOk = false;
  try {
    targetHostOk = ALLOWED_HOST.test(target);
  } catch {
    /* ignore */
  }
  if (!targetHostOk) {
    return new Response("Refusing to proxy non-CDN host.", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        "User-Agent": "Roblox/WinInet ( AnimForge/2.4 )",
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate",
      },
      // follow any further CDN redirects automatically
      redirect: "follow",
    });
  } catch {
    return new Response("Upstream fetch error.", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream fetch failed (${upstream.status}).`, {
      status: 502,
    });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") || "application/octet-stream",
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
  );
  // CORS: allow the browser to read + download the streamed blob.
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store");
  // Allow the client to track download progress.
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type");

  // Only forward a Content-Length when we are passing the raw (un-decoded)
  // body through unchanged, so the client's byte counter stays accurate.
  const decoded =
    (upstream.headers.get("content-encoding") || "").toLowerCase();
  if (decoded === "" && upstream.headers.get("content-length")) {
    headers.set("Content-Length", upstream.headers.get("content-length")!);
  }

  return new Response(upstream.body, { status: 200, headers });
}
