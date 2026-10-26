import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://berkshire01.github.io";
const SITE_PATH_PREFIX = "/Berkshiregroup01/";
const ADMIN_EMAIL = "yucilazra77@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

function getBrowserInfo(ua: string) {
  let browser = "Unknown browser";
  let version = "Unknown";

  const browserPatterns: [string, RegExp][] = [
    ["Microsoft Edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/i],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/i],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/i],
    ["Brave", /Brave\/([\d.]+)/i],
    ["Mozilla Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/i],
    ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/i],
    ["Safari", /Version\/([\d.]+).*Safari/i],
    ["Internet Explorer", /(?:MSIE\s|Trident\/.*rv:)([\d.]+)/i],
  ];

  for (const [name, pattern] of browserPatterns) {
    const match = ua.match(pattern);
    if (match) {
      browser = name;
      version = match[1];
      break;
    }
  }

  let operatingSystem = "Unknown";
  if (/Windows NT 10\.0/i.test(ua)) {
    operatingSystem = "Windows 10 or 11";
  } else if (/Windows NT 6\.3/i.test(ua)) {
    operatingSystem = "Windows 8.1";
  } else if (/Windows NT 6\.2/i.test(ua)) {
    operatingSystem = "Windows 8";
  } else if (/Windows NT 6\.1/i.test(ua)) {
    operatingSystem = "Windows 7";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    operatingSystem = "iOS";
  } else if (/Android/i.test(ua)) {
    operatingSystem = "Android";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    operatingSystem = "macOS";
  } else if (/CrOS/i.test(ua)) {
    operatingSystem = "ChromeOS";
  } else if (/Linux/i.test(ua)) {
    operatingSystem = "Linux";
  }

  let deviceType = "Desktop";
  if (/iPad|Tablet/i.test(ua) ||
      (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    deviceType = "Tablet";
  } else if (/Mobile|iPhone|iPod|Android/i.test(ua)) {
    deviceType = "Mobile";
  }

  return { browser, version, operatingSystem, deviceType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (req.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json({ error: "Origin not allowed." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("Visitor relay is missing Supabase configuration.");
    return json({
      error: "Visitor analytics is temporarily unavailable.",
    }, 503);
  }

  let data: Record<string, unknown>;

  try {
    const raw = await req.text();

    if (raw.length > 5000) {
      return json({ error: "Request too large." }, 413);
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Invalid request body." }, 400);
    }

    data = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  let page: URL;

  try {
    page = new URL(String(data.page_url || ""));
  } catch {
    return json({ error: "Invalid page URL." }, 400);
  }

  if (
    page.protocol !== "https:" ||
    page.origin !== ALLOWED_ORIGIN ||
    !page.pathname.startsWith(SITE_PATH_PREFIX)
  ) {
    return json({
      error: "Only Berkshire Group 01 pages can be tracked.",
    }, 400);
  }

  const pagePath = page.pathname.slice(0, 300);

  let referrerHost: string | null = null;
  let referrerPath: string | null = null;
  let source = "direct";

  const rawReferrer = String(data.referrer || "")
    .slice(0, 1000)
    .trim();

  if (rawReferrer) {
    try {
      const referrer = new URL(rawReferrer);

      if (
        referrer.protocol === "http:" ||
        referrer.protocol === "https:"
      ) {
        referrerHost = referrer.hostname.slice(0, 253);
        referrerPath = referrer.pathname.slice(0, 300);
        source = referrer.origin === ALLOWED_ORIGIN
          ? "internal"
          : referrer.hostname.slice(0, 253);
      }
    } catch {
      // Ignore invalid referrers.
    }
  }

  const userAgent = (
    req.headers.get("user-agent") || "Unknown"
  ).slice(0, 500);

  const {
    browser,
    version,
    operatingSystem,
    deviceType,
  } = getBrowserInfo(userAgent);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const saved = await supabase
    .from("visitor_analytics")
    .insert({
      page_path: pagePath,
      referrer_host: referrerHost,
      referrer_path: referrerPath,
      source,
    })
    .select("id, visited_at")
    .single();

  if (saved.error || !saved.data) {
    console.error(
      "Could not save visitor analytics:",
      saved.error?.message,
    );

    return json({ error: "Could not record this visit." }, 503);
  }

  let emailNotified = false;

  if (resendApiKey) {
    const visitedAt = new Date(saved.data.visited_at).toISOString();

    const safeTime = escapeHtml(visitedAt);
    const safePage = escapeHtml(pagePath);
    const safeSource = escapeHtml(source);
    const safeHost = escapeHtml(
      referrerHost || "None (direct visit)",
    );
    const safeReferrerPath = escapeHtml(referrerPath || "/");
    const safeBrowser = escapeHtml(browser);
    const safeVersion = escapeHtml(version);
    const safeOS = escapeHtml(operatingSystem);
    const safeDevice = escapeHtml(deviceType);

    const html = [
      "<h2>New Berkshire Group 01 website visit</h2>",
      "<p><strong>Time (UTC):</strong> " + safeTime + "</p>",
      "<p><strong>Page:</strong> " + safePage + "</p>",
      "<p><strong>Referral source:</strong> " + safeSource + "</p>",
      "<p><strong>Referrer host:</strong> " + safeHost + "</p>",
      "<p><strong>Referrer path:</strong> " + safeReferrerPath + "</p>",
      "<hr>",
      "<h3>Browser and device information</h3>",
      "<p><strong>Browser:</strong> " + safeBrowser + "</p>",
      "<p><strong>Browser version:</strong> " + safeVersion + "</p>",
      "<p><strong>Operating system:</strong> " + safeOS + "</p>",
      "<p><strong>Device type:</strong> " + safeDevice + "</p>",
      "<hr>",
      "<p>Visitor IP addresses are not stored by this relay.</p>",
      "<p>Browser and device details are estimates based on the user-agent header.</p>",
    ].join("");

    const textBody = [
      "New Berkshire Group 01 website visit",
      "",
      "Time (UTC): " + visitedAt,
      "Page: " + pagePath,
      "Referral source: " + source,
      "Referrer host: " + (referrerHost || "None (direct visit)"),
      "Referrer path: " + (referrerPath || "/"),
      "",
      "BROWSER AND DEVICE INFORMATION",
      "Browser: " + browser,
      "Browser version: " + version,
      "Operating system: " + operatingSystem,
      "Device type: " + deviceType,
      "",
      "Visitor IP addresses are not stored by this relay.",
      "Browser and device details are estimates based on the user-agent header.",
    ].join("\n");

    try {
      const emailResponse = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + resendApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Berkshire Group 01 <onboarding@resend.dev>",
            to: [ADMIN_EMAIL],
            subject: "Berkshire Group 01 — Website visit",
            html,
            text: textBody,
          }),
        },
      );

      if (emailResponse.ok) {
        emailNotified = true;
      } else {
        console.error(
          "Visitor notification email failed:",
          emailResponse.status,
          await emailResponse.text(),
        );
      }
    } catch (error) {
      console.error("Visitor notification email error:", error);
    }
  } else {
    console.warn(
      "RESEND_API_KEY is not configured; visit saved without email notification.",
    );
  }

  return json({
    success: true,
    recorded: true,
    email_notified: emailNotified,
    browser,
    browser_version: version,
    operating_system: operatingSystem,
    device_type: deviceType,
  }, 201);
});
