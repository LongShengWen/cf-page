export interface Env {
  NAV_DB: D1Database;
  ADMIN_TOKEN: string;
  ASSETS: Fetcher;
  ICON_BUCKET: R2Bucket;
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonBody(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const MAX_ICON_BYTES = 2 * 1024 * 1024;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractHref(tag: string, attr: string): string | null {
  const match = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
  return match?.[1] ?? null;
}

function isIconRel(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    lower.includes("icon") ||
    lower.includes("apple-touch-icon") ||
    lower.includes("mask-icon") ||
    lower.includes("shortcut")
  );
}

async function fetchManifestIcons(manifestUrl: string): Promise<string[]> {
  try {
    const res = await fetch(manifestUrl, { redirect: "follow" });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as { icons?: Array<{ src?: string }> };
    const icons = Array.isArray(json.icons) ? json.icons : [];
    return icons
      .map((icon) => (typeof icon.src === "string" ? icon.src : ""))
      .filter((src) => src);
  } catch {
    return [];
  }
}

async function collectIconCandidatesFromUrl(targetUrl: string): Promise<string[]> {
  const base = targetUrl;
  const candidates = new Set<string>();

  candidates.add(new URL("/favicon.ico", base).toString());
  candidates.add(new URL("/apple-touch-icon.png", base).toString());
  candidates.add(new URL("/apple-touch-icon-precomposed.png", base).toString());

  const res = await fetch(targetUrl, { redirect: "follow" });
  if (!res.ok) {
    return Array.from(candidates);
  }

  const html = await res.text();

  const linkTagRegex = /<link[^>]+>/gi;
  const metaTagRegex = /<meta[^>]+>/gi;
  const links = html.match(linkTagRegex) ?? [];
  const metas = html.match(metaTagRegex) ?? [];

  const manifestUrls: string[] = [];
  for (const tag of links) {
    const rel = extractHref(tag, "rel");
    const href = extractHref(tag, "href");
    if (!href) {
      continue;
    }
    if (rel && rel.toLowerCase().includes("manifest")) {
      const resolved = resolveUrl(base, href);
      if (resolved) {
        manifestUrls.push(resolved);
      }
      continue;
    }
    if (rel && isIconRel(rel)) {
      const resolved = resolveUrl(base, href);
      if (resolved) {
        candidates.add(resolved);
      }
    }
  }

  for (const tag of metas) {
    const property = extractHref(tag, "property");
    const content = extractHref(tag, "content");
    if (property && property.toLowerCase() === "og:image" && content) {
      const resolved = resolveUrl(base, content);
      if (resolved) {
        candidates.add(resolved);
      }
    }
  }

  for (const manifestUrl of manifestUrls) {
    const icons = await fetchManifestIcons(manifestUrl);
    for (const icon of icons) {
      const resolved = resolveUrl(manifestUrl, icon);
      if (resolved) {
        candidates.add(resolved);
      }
    }
  }

  return Array.from(candidates);
}

async function handleIconCandidates(request: Request, env: Env): Promise<Response> {
  if (!isAdminToken(request, env)) {
    return textResponse("Unauthorized", 401);
  }
  const url = new URL(request.url);
  const target = url.searchParams.get("url") ?? "";
  if (!isHttpUrl(target)) {
    return textResponse("Invalid url", 400);
  }
  const candidates = await collectIconCandidatesFromUrl(target);
  return jsonBody({ candidates });
}

function contentTypeToExt(contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  switch (type) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "image/gif":
      return ".gif";
    case "image/avif":
      return ".avif";
    default:
      return "";
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

// auth helpers

function parseDataUrl(value: string): { contentType: string; data: ArrayBuffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);
  if (!match) {
    return null;
  }
  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { contentType, data: bytes.buffer };
}

async function storeImage(
  contentType: string,
  data: ArrayBuffer,
  env: Env,
): Promise<string | null> {
  if (data.byteLength > MAX_ICON_BYTES) {
    return null;
  }
  const hash = await sha256Hex(data);
  const ext = contentTypeToExt(contentType);
  const key = `manual/${hash}${ext}`;
  await env.ICON_BUCKET.put(key, data, {
    httpMetadata: { contentType },
  });
  return `/icons/${key}`;
}

async function storeImageFromUrl(url: string, env: Env): Promise<string | null> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }
    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_ICON_BYTES) {
      return null;
    }
    const data = await response.arrayBuffer();
    return await storeImage(contentType, data, env);
  } catch {
    return null;
  }
}

async function storeImageFromDataUrl(value: string, env: Env): Promise<string | null> {
  try {
    const parsed = parseDataUrl(value);
    if (!parsed) {
      return null;
    }
    return await storeImage(parsed.contentType, parsed.data, env);
  } catch {
    return null;
  }
}

function isAdminToken(request: Request, env: Env): boolean {
  const auth = request.headers.get("authorization") ?? request.headers.get("x-admin-token");
  if (!auth) {
    return false;
  }
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : auth;
  return token === env.ADMIN_TOKEN;
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  if (!isAdminToken(request, env)) {
    return textResponse("Unauthorized", 401);
  }
  const row = await env.NAV_DB.prepare("SELECT data FROM nav WHERE id = 1")
    .first<{ data: string }>();
  return jsonResponse(row?.data ?? "[]");
}

async function handlePut(request: Request, env: Env): Promise<Response> {
  if (!isAdminToken(request, env)) {
    return textResponse("Unauthorized", 401);
  }

  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return textResponse("Invalid JSON", 400);
  }

  const isArray = Array.isArray(parsed);
  const isObject = typeof parsed === "object" && parsed !== null;
  const groups = isArray
    ? parsed
    : isObject && Array.isArray((parsed as { groups?: unknown }).groups)
      ? (parsed as { groups: unknown[] }).groups
      : null;
  if (!groups) {
    return textResponse("Invalid payload", 400);
  }

  const processedGroups = await Promise.all(
    groups.map(async (group) => {
      const rawGroup = (group ?? {}) as Record<string, unknown>;
      const rawItems = Array.isArray(rawGroup.items) ? rawGroup.items : [];
      const items = await Promise.all(
        rawItems.map(async (item) => {
          const rawItem = (item ?? {}) as Record<string, unknown>;
          const imageUrl = typeof rawItem.imageUrl === "string" ? rawItem.imageUrl : "";
          const iconMode =
            rawItem.iconMode === "manual" || rawItem.iconMode === "auto"
              ? rawItem.iconMode
              : imageUrl
                ? "manual"
                : "auto";

          let nextImageUrl = imageUrl;
          if (iconMode === "manual") {
            const trimmed = imageUrl.trim();
            const lower = trimmed.toLowerCase();
            if (trimmed && !lower.startsWith("/icons/")) {
              if (lower.startsWith("data:image/")) {
                const stored = await storeImageFromDataUrl(trimmed, env);
                if (stored) {
                  nextImageUrl = stored;
                }
              } else if (isHttpUrl(trimmed)) {
                const stored = await storeImageFromUrl(trimmed, env);
                if (stored) {
                  nextImageUrl = stored;
                }
              }
            }
          }

          return {
            ...rawItem,
            iconMode,
            imageUrl: nextImageUrl,
          };
        }),
      );
      return {
        ...rawGroup,
        items,
      };
    }),
  );

  const payload = isArray
    ? processedGroups
    : {
        settings: (parsed as { settings?: unknown }).settings ?? {},
        groups: processedGroups,
      };

  const now = new Date().toISOString();
  await env.NAV_DB.prepare(
    "INSERT INTO nav (id, data, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  )
    .bind(JSON.stringify(payload), now)
    .run();
  return textResponse("OK", 200);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return textResponse("Invalid JSON", 400);
  }
  const body = (payload ?? {}) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return textResponse("认证口令不能为空", 400);
  }
  if (token !== env.ADMIN_TOKEN) {
    return textResponse("认证口令错误", 401);
  }
  return jsonBody({ ok: true }, 200);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  if (!isAdminToken(request, env)) {
    return textResponse("Unauthorized", 401);
  }
  return jsonBody({ ok: true }, 200);
}

async function handleLogout(): Promise<Response> {
  return textResponse("OK", 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/icons/")) {
      const key = decodeURIComponent(url.pathname.slice("/icons/".length));
      if (!key) {
        return textResponse("Not Found", 404);
      }
      const object = await env.ICON_BUCKET.get(key);
      if (!object) {
        return textResponse("Not Found", 404);
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      if (!headers.get("content-type")) {
        headers.set("content-type", "application/octet-stream");
      }
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/api/nav") {
      if (request.method === "GET") {
        return handleGet(request, env);
      }
      if (request.method === "PUT") {
        return handlePut(request, env);
      }
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname === "/api/icon-candidates") {
      if (request.method === "GET") {
        return handleIconCandidates(request, env);
      }
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname === "/api/login") {
      if (request.method === "POST") {
        return handleLogin(request, env);
      }
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname === "/api/logout") {
      if (request.method === "POST") {
        return handleLogout();
      }
      return textResponse("Method Not Allowed", 405);
    }

    if (url.pathname === "/api/me") {
      if (request.method === "GET") {
        return handleMe(request, env);
      }
      return textResponse("Method Not Allowed", 405);
    }

    return env.ASSETS.fetch(request);
  },
};
