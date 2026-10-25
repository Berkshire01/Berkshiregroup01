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
    return json({ error: "Visitor analytics is temporarily unavailable." }, 503);
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
    return json({ error: "Only Berkshire Group 01 pages can be tracked." }, 400);
  }

  // Store only the page path, not query parameters that could contain personal data.
  const pagePath = page.pathname.slice(0, 300);
  let referrerHost: string | null = null;
  let referrerPath: string | null = null;
  let source = "direct";

  const rawReferrer = String(data.referrer || "").slice(0, 1000).trim();
  if (rawReferrer) {
    try {
      const referrer = new URL(rawReferrer);
      if (referrer.protocol === "http:" || referrer.protocol === "https:") {
        referrerHost = referrer.hostname.slice(0, 253);
        referrerPath = referrer.pathname.slice(0, 300);
        source = referrer.origin === ALLOWED_ORIGIN
          ? "internal"
          : referrer.hostname.slice(0, 253);
      }
    } catch {
      // Ignore invalid referrers and classify this as a direct visit.
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
    console.error("Could not save visitor analytics:", saved.error?.message);
    return json({ error: "Could not record this visit." }, 503);
  }

  let emailNotified = false;

  if (resendApiKey) {
    const visitedAt = new Date(saved.data.visited_at).toISOString();
    const safePath = escapeHtml(pagePath);
    const safeSource = escapeHtml(source);
    const safeHost = escapeHtml(referrerHost || "None (direct visit)");
    const safeReferrerPath = escapeHtml(referrerPath || "/");

    const html = [
      "<h2>New Berkshire Group 01 website visit</h2>",
      "<p><strong>Time (UTC):</strong> " + escapeHtml(visitedAt) + "</p>",
      "<p><strong>Page:</strong> " + safePath + "</p>",
      "<p><strong>Referral source:</strong> " + safeSource + "</p>",
      "<p><strong>Referrer host:</strong> " + safeHost + "</p>",
      "<p><strong>Referrer path:</strong> " + safeReferrerPath + "</p>",
      "<p>Visitor IP addresses and unnecessary personal information are not stored by this relay.</p>",
    ].join("");

    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
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
          text:
            "New Berkshire Group 01 website visit\n\n" +
            "Time (UTC): " + visitedAt + "\n" +
            "Page: " + pagePath + "\n" +
            "Referral source: " + source + "\n" +
            "Referrer host: " + (referrerHost || "None (direct visit)") + "\n" +
            "Referrer path: " + (referrerPath || "/") + "\n\n" +
            "Visitor IP addresses are not stored by this relay.",
        }),
      });

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
    console.warn("RESEND_API_KEY is not configured; visit saved without email notification.");
  }

  return json({
    success: true,
    recorded: true,
    email_notified: emailNotified,
  }, 201);
});
