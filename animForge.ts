/**
 * AnimForge — Multi-step Roblox animation resolver.
 *
 * Handles the notorious "No accessible CDN location" error that newer,
 * restricted assets throw when requested through the standard endpoint.
 *
 * Resolution pipeline:
 *
 *   0. Standard request
 *        GET https://assetdelivery.roblox.com/v1/asset/?id={ID}
 *        -> { location } on success.
 *
 *   1. Identify the asset's Universe ID  ("Identifying Universe...")
 *        a. https://apis.roblox.com/universes/v1/places/{ID}/universe
 *        b. https://economy.roblox.com/v2/assets/{ID}/details  (creation context)
 *
 *   2. Authenticated request simulation  ("Bypassing CDN Restrictions...")
 *        GET https://assetdelivery.roblox.com/v1/asset/?id={ID}&universeId={UNIVERSE_ID}
 *        Adding the `universeId` parameter is what unlocks restricted CDN
 *        locations — it mimics an in-experience request.
 *
 *   3. Legacy fallback
 *        GET https://assetdelivery.roblox.com/v1/assetId/{ID}
 *        Sometimes skips the metadata gate entirely.
 *
 * The generator yields typed status events so callers (e.g. an SSE route) can
 * stream live progress to the UI, ending with either a `ready` event
 * (resolved CDN URL) or an `error`.
 */

const ROBLOX_UA =
  "Roblox/WinInet ( AnimForge/2.4; +https://animforge.app )";
const TIMEOUT_MS = 12000;

export type StatusLevel = "info" | "success" | "warn" | "error";

export type ForgeStep =
  | "parse"
  | "query"
  | "cdn-block"
  | "universe"
  | "bypass"
  | "fallback"
  | "resolve"
  | "download"
  | "error";

export interface ForgeStatusEvent {
  type: "status";
  level: StatusLevel;
  step: ForgeStep;
  message: string;
  detail?: string;
}

export interface ForgeReadyEvent {
  type: "ready";
  /** Resolved CDN location hosting the raw asset. */
  location: string;
  /** Same location wrapped in corsproxy.io for client-side blob relay. */
  proxyLocation: string;
  filename: string;
  contentType: string;
  size: number;
  universeId: number | null;
}

export interface ForgeErrorEvent {
  type: "error";
  message: string;
}

export type ForgeEvent = ForgeStatusEvent | ForgeReadyEvent | ForgeErrorEvent;

/** Wrap any URL with corsproxy.io for client-side fetching. */
export function buildProxyUrl(target: string): string {
  return `https://corsproxy.io/?url=${encodeURIComponent(target)}`;
}

/** Parse a raw ID or any Roblox URL/form into a numeric asset id string. */
export function parseInput(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // Roblox inline asset reference: rbxassetid://12345
  const inline = raw.replace(/^rbxassetid:\/\//i, "").trim();
  if (/^\d+$/.test(inline)) return inline;

  if (/^\d+$/.test(raw)) return raw;

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const idParam = url.searchParams.get("id");
    if (idParam && /^\d+$/.test(idParam)) return idParam;
    const segments = url.pathname.split("/").filter(Boolean);
    for (const seg of segments) {
      if (/^\d{5,}$/.test(seg)) return seg;
    }
  } catch {
    /* not a URL — fall through to digit scan */
  }

  const digits = raw.match(/\d{5,}/);
  return digits ? digits[0] : null;
}

/** Human-readable byte formatting. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const decimals = value < 10 && i > 0 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeout = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface DeliveryResult {
  location: string | null;
  blocked: boolean;
}

/**
 * Hit an assetdelivery URL and normalise the response into either a resolved
 * `location` string or a `blocked` flag (covers JSON envelopes, raw redirects
 * and error payloads alike).
 */
async function requestAssetDelivery(url: string): Promise<DeliveryResult> {
  try {
    const res = await fetchWithTimeout(url, {
      redirect: "follow",
      headers: {
        "User-Agent": ROBLOX_UA,
        Accept: "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Case A — success via 302 redirect straight to the CDN. The final URL is
    // the asset location; no need to download the binary body at all.
    if (res.redirected && res.ok && !res.url.includes("assetdelivery.roblox.com")) {
      return { location: res.url, blocked: false };
    }
    // Case A2 — final URL is a non-assetdelivery host (some CDNs answer 200).
    if (res.ok && res.url && /\.rbxcdn\.com/i.test(res.url)) {
      return { location: res.url, blocked: false };
    }

    // Case B — assetdelivery JSON envelope: { location } or an error payload.
    const contentType = res.headers.get("content-type") || "";
    const bodyText = await res.text();
    if (contentType.includes("json") || bodyText.trim().startsWith("{")) {
      try {
        const json = JSON.parse(bodyText);
        if (typeof json.location === "string" && json.location) {
          return { location: json.location, blocked: false };
        }
        const errMessage: string =
          json?.errors?.[0]?.message || json?.message || "";
        const blocked =
          /no accessible cdn/i.test(errMessage) ||
          /not available for/i.test(errMessage) ||
          res.status >= 400;
        return { location: null, blocked };
      } catch {
        /* malformed JSON — fall through */
      }
    }

    return { location: null, blocked: !res.ok };
  } catch {
    return { location: null, blocked: true };
  }
}

/** Resolve the owning Universe id for an asset via two public sources. */
async function identifyUniverse(id: string): Promise<number | null> {
  // (a) places -> universe mapping.
  try {
    const res = await fetchWithTimeout(
      `https://apis.roblox.com/universes/v1/places/${id}/universe`,
      { headers: { "User-Agent": ROBLOX_UA, Accept: "application/json" } },
    );
    if (res.ok) {
      const json = (await res.json()) as { universeId?: number };
      if (json && typeof json.universeId === "number") return json.universeId;
    }
  } catch {
    /* try next source */
  }

  // (b) asset details — read the creation context for an embedded universe.
  try {
    const res = await fetchWithTimeout(
      `https://economy.roblox.com/v2/assets/${id}/details`,
      { headers: { "User-Agent": ROBLOX_UA, Accept: "application/json" } },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        universeId?: number;
        creationContext?: { universe?: { id?: number }; universeId?: number };
      };
      const fromCtx =
        json?.creationContext?.universe?.id ??
        json?.creationContext?.universeId;
      if (fromCtx) return Number(fromCtx);
      if (json?.universeId) return Number(json.universeId);
    }
  } catch {
    /* give up gracefully */
  }

  return null;
}

/**
 * The heart of AnimForge. Yields status events as it walks the resolution
 * pipeline, finishing with a `ready` (success) or `error` event.
 */
export async function* resolveAnimation(
  input: string,
): AsyncGenerator<ForgeEvent> {
  const id = parseInput(input);
  if (!id) {
    yield {
      type: "error",
      message: "Could not parse a valid Roblox asset ID from the input.",
    };
    return;
  }

  yield {
    type: "status",
    level: "success",
    step: "parse",
    message: `Asset ID ${id} locked.`,
    detail: "Input parsed",
  };

  // --- Stage 0: standard delivery request -------------------------------
  yield {
    type: "status",
    level: "info",
    step: "query",
    message: "Querying asset delivery…",
    detail: "GET assetdelivery.roblox.com/v1/asset",
  };

  let universeId: number | null = null;
  let result = await requestAssetDelivery(
    `https://assetdelivery.roblox.com/v1/asset/?id=${id}`,
  );

  // --- Stage 1: the CDN block — engage the bypass -----------------------
  if (!result.location) {
    yield {
      type: "status",
      level: "warn",
      step: "cdn-block",
      message: "No accessible CDN location — engaging bypass protocol.",
      detail: "Restricted / moderated asset detected",
    };

    // 1a — Identify Universe
    yield {
      type: "status",
      level: "info",
      step: "universe",
      message: "Identifying Universe…",
      detail: "apis.roblox.com · economy.roblox.com",
    };
    universeId = await identifyUniverse(id);

    if (universeId) {
      yield {
        type: "status",
        level: "success",
        step: "universe",
        message: `Universe ${universeId} identified.`,
        detail: "Place → Universe mapping resolved",
      };

      // 1b — Authenticated request simulation (the actual unlock)
      yield {
        type: "status",
        level: "info",
        step: "bypass",
        message: "Bypassing CDN Restrictions…",
        detail: `assetdelivery + universeId=${universeId}`,
      };
      result = await requestAssetDelivery(
        `https://assetdelivery.roblox.com/v1/asset/?id=${id}&universeId=${universeId}`,
      );
    } else {
      yield {
        type: "status",
        level: "warn",
        step: "universe",
        message: "Universe mapping unavailable — skipping auth simulation.",
        detail: "Proceeding to legacy resolver",
      };
    }

    // --- Stage 2: legacy fallback --------------------------------------
    if (!result.location) {
      yield {
        type: "status",
        level: "warn",
        step: "fallback",
        message: "Fallback: legacy assetId resolver…",
        detail: "assetdelivery.roblox.com/v1/assetId",
      };
      result = await requestAssetDelivery(
        `https://assetdelivery.roblox.com/v1/assetId/${id}`,
      );
    }
  }

  if (!result.location) {
    yield {
      type: "error",
      message:
        "Resolution failed — asset is private, moderated, deleted, or invalid.",
    };
    return;
  }

  // --- Stage 3: finalise (probe metadata for the status log) -----------
  yield {
    type: "status",
    level: "info",
    step: "resolve",
    message: "CDN location resolved.",
    detail: "Probing download mirror…",
  };

  let size = 0;
  let contentType = "application/octet-stream";
  try {
    const probe = await fetchWithTimeout(result.location, {
      method: "GET",
      headers: { Range: "bytes=0-0", "User-Agent": ROBLOX_UA },
    });
    contentType = probe.headers.get("content-type") || contentType;
    const contentRange = probe.headers.get("content-range");
    const contentLength = probe.headers.get("content-length");
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) size = Number(match[1]);
    } else if (contentLength) {
      size = Number(contentLength);
    }
    try {
      await probe.body?.cancel();
    } catch {
      /* ignore */
    }
  } catch {
    /* metadata probe is best-effort */
  }

  yield {
    type: "ready",
    location: result.location,
    proxyLocation: buildProxyUrl(result.location),
    filename: `AnimForge_${id}.rbxm`,
    contentType,
    size,
    universeId,
  };
}
