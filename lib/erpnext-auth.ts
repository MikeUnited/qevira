/**
 * ERPNext / Frappe REST auth helpers.
 * - Trims env values (common .env copy/paste issue).
 * - Sends X-Frappe-Site-Name (needed for many Docker / multi-site setups).
 * - Retries with Basic auth if token auth returns 401.
 */

export type ErpnextEnv = {
  baseUrl: string;
  siteName: string;
  apiKey: string;
  apiSecret: string;
};

export function readErpnextEnv(): ErpnextEnv | { error: string } {
  const baseUrl = process.env.ERPNEXT_URL?.trim().replace(/\/+$/, "");
  const siteName =
    process.env.ERPNEXT_SITE_NAME?.trim() ||
    process.env.FRAPPE_SITE?.trim() ||
    "frontend";
  const apiKey = process.env.ERPNEXT_API_KEY?.trim();
  const apiSecret = process.env.ERPNEXT_API_SECRET?.trim();

  if (!baseUrl || !apiKey || !apiSecret) {
    return {
      error:
        "Missing ERPNEXT_URL, ERPNEXT_API_KEY, or ERPNEXT_API_SECRET (check .env.local)",
    };
  }

  return { baseUrl, siteName, apiKey, apiSecret };
}

function resolveAuthPair(
  env: ErpnextEnv,
  tenantCredentials?: { apiKey: string; apiSecret: string }
): { apiKey: string; apiSecret: string } {
  if (tenantCredentials) {
    return {
      apiKey: tenantCredentials.apiKey,
      apiSecret: tenantCredentials.apiSecret,
    };
  }
  return { apiKey: env.apiKey, apiSecret: env.apiSecret };
}

function tokenHeaders(
  env: ErpnextEnv,
  jsonBody: boolean,
  tenantCredentials?: { apiKey: string; apiSecret: string }
): HeadersInit {
  const { apiKey, apiSecret } = resolveAuthPair(env, tenantCredentials);
  const h: Record<string, string> = {
    Authorization: `token ${apiKey}:${apiSecret}`,
    "X-Frappe-Site-Name": env.siteName,
    Accept: "application/json",
  };
  if (jsonBody) {
    h["Content-Type"] = "application/json";
  }
  return h;
}

function basicHeaders(
  env: ErpnextEnv,
  jsonBody: boolean,
  tenantCredentials?: { apiKey: string; apiSecret: string }
): HeadersInit {
  const { apiKey, apiSecret } = resolveAuthPair(env, tenantCredentials);
  const raw = `${apiKey}:${apiSecret}`;
  const b64 = Buffer.from(raw, "utf8").toString("base64");
  const h: Record<string, string> = {
    Authorization: `Basic ${b64}`,
    "X-Frappe-Site-Name": env.siteName,
    Accept: "application/json",
  };
  if (jsonBody) {
    h["Content-Type"] = "application/json";
  }
  return h;
}

/** GET/POST to ERPNext; retries with Basic if token returns 401. */
export async function erpnextFetch(
  env: ErpnextEnv,
  path: string,
  init: RequestInit = {},
  tenantCredentials?: { apiKey: string; apiSecret: string }
): Promise<Response> {
  if (!tenantCredentials && process.env.NODE_ENV === "development") {
    console.warn(`[AUTH] Using global fallback for ${path}`);
  }

  const url = path.startsWith("http")
    ? path
    : `${env.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const hasBody =
    typeof init.body === "string" && init.body.length > 0;

  const base = { ...init };
  const mergedToken = {
    ...base,
    headers: {
      ...tokenHeaders(env, hasBody, tenantCredentials),
      ...(init.headers as Record<string, string>),
    },
  };

  let res = await fetch(url, mergedToken);

  if (res.status === 401) {
    console.warn(
      "[erpnext] 401 with token auth; retrying with Basic + X-Frappe-Site-Name"
    );
    res = await fetch(url, {
      ...base,
      headers: {
        ...basicHeaders(env, hasBody, tenantCredentials),
        ...(init.headers as Record<string, string>),
      },
    });
  }

  return res;
}

/**
 * POST multipart (e.g. upload_file). Do not set Content-Type — fetch sets the boundary.
 * `buildFormData` is called per attempt so the body can be read twice on 401 retry.
 */
export async function erpnextFetchMultipart(
  env: ErpnextEnv,
  path: string,
  buildFormData: () => FormData
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `${env.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const tokenOnly: Record<string, string> = {
    Authorization: `token ${env.apiKey}:${env.apiSecret}`,
    "X-Frappe-Site-Name": env.siteName,
    Accept: "application/json",
  };

  let res = await fetch(url, {
    method: "POST",
    headers: tokenOnly,
    body: buildFormData(),
  });

  if (res.status === 401) {
    console.warn(
      "[erpnext] multipart 401 with token auth; retrying with Basic + X-Frappe-Site-Name"
    );
    const raw = `${env.apiKey}:${env.apiSecret}`;
    const b64 = Buffer.from(raw, "utf8").toString("base64");
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${b64}`,
        "X-Frappe-Site-Name": env.siteName,
        Accept: "application/json",
      },
      body: buildFormData(),
    });
  }

  return res;
}
