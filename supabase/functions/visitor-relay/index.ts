const corsHeaders = {
  "Access-Control-Allow-Origin": "https://berkshire-group.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

async function hashIp(ip: string, secret: string) {
  const bytes = new TextEncoder().encode(`${secret}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (
    req.headers.get("origin") !== "https://berkshire-group.github.io"
  ) {
    return json({ error: "Origin not allowed" }, 403);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hashSecret = Deno.env.get("VISITOR_HASH_SECRET");

  if (!resendKey || !supabaseUrl || !serviceKey || !hashSecret) {
    console.error("Required server configuration is missing.");
    return json({ error: "Server configuration incomplete" }, 500);
  }

  let data;
  try {
    const raw = await req.text();
    if (raw.length > 5000) {
      return json({ error: "Request too large" }, 413);
    }
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const pageUrl = String(data.page_url || "");
  if (
    pageUrl !== "https://berkshire-group.github.io/Berkshire-Group/" &&
    pageUrl !== "https://berkshire-group.github.io/Berkshire-Group-/"
  ) {
    return json({ error: "Only the landing page is allowed" }, 400);
  }

  // Use a client IP header supplied by the gateway, never an IP
  // provided in the JSON body. If unavailable, fail safely.
  const ip = req.headers.get("cf-connecting-ip")?.trim();

  if (!ip || ip.length > 100) {
    console.error("Client IP header unavailable.");
    return json({ error: "Could not identify visitor IP" }, 503);
  }

  const ipHash = await hashIp(ip, hashSecret);
  const baseUrl = supabaseUrl.replace(/\/+$/, "");

  async function callRpc(name: string) {
    return await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_ip_hash: ipHash }),
    });
  }

  let claimResponse: Response;
  try {
    claimResponse = await callRpc("claim_visitor_ip");
  } catch (error) {
    console.error("Database request failed:", error);
    return json({ error: "Visitor check unavailable" }, 503);
  }

  if (!claimResponse.ok) {
    console.error("Database claim failed:", claimResponse.status);
    return json({ error: "Visitor check failed" }, 503);
  }

  const claimed = await claimResponse.json().catch(() => null);

  if (claimed === false) {
    return json({
      success: true,
      notified: false,
      message: "This IP has already been notified",
    });
  }

  if (claimed !== true) {
    console.error("Unexpected database claim response.");
    return json({ error: "Unexpected visitor check response" }, 503);
  }

  const visitorTime = new Date().toISOString();
  const referrer = escapeHtml(
    String(data.referrer || "Not provided").slice(0, 500),
  );
  const userAgent = escapeHtml(
    String(data.user_agent || "Not provided").slice(0, 500),
  );

  const html = `
    <h2>New Berkshire Group landing-page visit</h2>
    <p><b>Time (UTC):</b> ${visitorTime}</p>
    <p><b>Page:</b> ${escapeHtml(pageUrl)}</p>
    <p><b>Referrer:</b> ${referrer}</p>
    <p><b>Browser:</b> ${userAgent}</p>
    <p><b>IP:</b> Hashed for duplicate detection; not displayed.</p>
  `;

  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Berkshire Group <onboarding@resend.dev>",
        to: ["lindawyatt061@gmail.com"],
        subject: "Berkshire Group — Landing Page Visitor",
        html,
      }),
    });

    if (!emailResponse.ok) {
      console.error("Resend failed:", emailResponse.status);
      const releaseResponse = await callRpc("release_visitor_ip");
      if (!releaseResponse.ok) {
        console.error("Could not release IP claim.");
      }
      return json({ error: "Email sending failed" }, 502);
    }

    return json({
      success: true,
      notified: true,
      message: "First notification accepted by Resend",
    });
  } catch (error) {
    console.error("Email request failed:", error);
    try {
      await callRpc("release_visitor_ip");
    } catch (releaseError) {
      console.error("Could not release IP claim:", releaseError);
    }
    return json({ error: "Email service unavailable" }, 502);
  }
});
