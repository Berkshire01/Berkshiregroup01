import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const BUCKET = "employment-id-documents";
const ALLOWED_STATUSES = new Set(["new", "in_review", "interview", "hired", "rejected", "withdrawn"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmails = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!url || !serviceKey || adminEmails.length === 0) {
    console.error("admin-employment missing required server configuration");
    return json({ error: "Admin service is not configured." }, 503);
  }
  const match = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Please sign in as an authorized administrator." }, 401);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(match[1]);
  if (userError || !userData.user?.email) return json({ error: "Your session is invalid or expired. Please sign in again." }, 401);
  if (!adminEmails.includes(userData.user.email.toLowerCase())) return json({ error: "You are not authorized to view employment applications." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  if (body.action === "list") {
    const requested = Number(body.limit ?? 100);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 100;
    const { data, error } = await supabase.from("employment_applications").select("id,created_at,status,notification_status").order("created_at", { ascending: false }).limit(limit);
    if (error) {
      console.error("Application list failed:", error.message);
      return json({ error: "Could not load applications." }, 500);
    }
    return json({ applications: data || [] });
  }

  if (body.action === "detail") {
    const id = String(body.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return json({ error: "Invalid application reference." }, 400);
    const { data, error } = await supabase.from("employment_applications").select("id,created_at,status,notification_status,payload,front_storage_path,back_storage_path").eq("id", id).maybeSingle();
    if (error || !data) return json({ error: "Application not found." }, 404);
    const [front, back] = await Promise.all([
      supabase.storage.from(BUCKET).createSignedUrl(data.front_storage_path, 60),
      supabase.storage.from(BUCKET).createSignedUrl(data.back_storage_path, 60),
    ]);
    if (front.error || back.error || !front.data?.signedUrl || !back.data?.signedUrl) {
      console.error("Could not create temporary ID links");
      return json({ error: "Could not create temporary ID document links." }, 500);
    }
    return json({ application: {
      id: data.id, created_at: data.created_at, status: data.status, notification_status: data.notification_status,
      payload: data.payload, documents: { front_url: front.data.signedUrl, back_url: back.data.signedUrl },
    } });
  }

  if (body.action === "update-status") {
    const id = String(body.id || ""), status = String(body.status || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !ALLOWED_STATUSES.has(status)) {
      return json({ error: "Invalid application reference or status." }, 400);
    }
    const { data, error } = await supabase.from("employment_applications").update({ status }).eq("id", id).select("id,status").maybeSingle();
    if (error || !data) {
      console.error("Application status update failed:", error?.message || "not found");
      return json({ error: "Could not update the application status." }, 500);
    }
    return json({ application: data });
  }
  return json({ error: "Unsupported action." }, 400);
});
