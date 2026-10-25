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
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const BUCKET = "employment-id-documents";

function extensionFor(type: string) {
  return ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type] || "bin";
}
async function verifyTurnstile(token: string, secret: string, remoteIp?: string) {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!response.ok) return false;
  return (await response.json()).success === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!url || !serviceKey || !turnstileSecret) {
    console.error("submit-employment missing required server configuration");
    return json({ error: "Online applications are temporarily unavailable." }, 503);
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Please submit the application form again." }, 400); }
  if (String(form.get("website") || "").trim()) return json({ application_id: "received" });

  const token = String(form.get("cf-turnstile-response") || "");
  if (!token || !(await verifyTurnstile(token, turnstileSecret, req.headers.get("CF-Connecting-IP") || undefined))) {
    return json({ error: "Verification failed. Please complete the verification check and try again." }, 400);
  }
  const front = form.get("driver_license_id_front"), back = form.get("driver_license_id_back");
  if (!(front instanceof File) || !(back instanceof File) || !front.size || !back.size) {
    return json({ error: "Please upload both the front and back of your ID." }, 400);
  }
  for (const file of [front, back]) {
    if (file.size > MAX_FILE_BYTES) return json({ error: "Each ID file must be 8 MB or smaller." }, 413);
    if (!ALLOWED_TYPES.has(file.type)) return json({ error: "ID files must be a PDF or a supported image (JPEG, PNG, WebP, GIF)." }, 400);
  }

  const payload: Record<string, string | string[]> = {};
  for (const [key, value] of form.entries()) {
    if (["driver_license_id_front", "driver_license_id_back", "cf-turnstile-response", "website"].includes(key) || typeof value !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const previous = payload[key];
      payload[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
    } else payload[key] = value;
  }
  if (!String(payload.first_name || "").trim() || !String(payload.last_name || "").trim() ||
      !String(payload.email || "").trim() || !String(payload.social_security_number || "").trim()) {
    return json({ error: "Please complete the required name, email, and identification fields." }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = crypto.randomUUID(), frontPath = id + "/front." + extensionFor(front.type), backPath = id + "/back." + extensionFor(back.type);
  const frontResult = await supabase.storage.from(BUCKET).upload(frontPath, front, { upsert: false, cacheControl: "0", contentType: front.type });
  if (frontResult.error) {
    console.error("Front ID upload failed:", frontResult.error.message);
    return json({ error: "We could not securely save your ID files. Please try again." }, 500);
  }
  const backResult = await supabase.storage.from(BUCKET).upload(backPath, back, { upsert: false, cacheControl: "0", contentType: back.type });
  if (backResult.error) {
    await supabase.storage.from(BUCKET).remove([frontPath]);
    console.error("Back ID upload failed:", backResult.error.message);
    return json({ error: "We could not securely save your ID files. Please try again." }, 500);
  }
  const inserted = await supabase.from("employment_applications").insert({
    id, payload, front_storage_path: frontPath, back_storage_path: backPath,
    status: "new", notification_status: "not_configured",
  }).select("id").single();
  if (inserted.error) {
    await supabase.storage.from(BUCKET).remove([frontPath, backPath]);
    console.error("Application insert failed:", inserted.error.message);
    return json({ error: "We could not save your application. Please try again." }, 500);
  }
  // Send an applicant-only receipt email. Email errors must not undo the saved application.
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const applicantEmail = String(payload.email || "").trim();
  let notificationStatus = "not_configured";

  if (resendApiKey && applicantEmail) {
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Berkshire Group 01 <onboarding@resend.dev>",
          to: [applicantEmail],
          subject: "We received your employment application",
          text:
            "Thank you for applying to Berkshire Group 01.\\n\\n" +
            "We have received your employment application successfully. " +
            "Our team will review it and contact you if further information is needed.\\n\\n" +
            "This email confirms receipt only; it does not indicate a hiring decision.\\n\\n" +
            "Berkshire Group 01",
        }),
      });

      if (emailResponse.ok) {
        notificationStatus = "sent";
      } else {
        const errorDetails = await emailResponse.text();
        console.error("Applicant confirmation email failed:", errorDetails);
        notificationStatus = "failed";
      }
    } catch (error) {
      console.error("Applicant confirmation email error:", error);
      notificationStatus = "failed";
    }

    const notificationUpdate = await supabase
      .from("employment_applications")
      .update({ notification_status: notificationStatus })
      .eq("id", inserted.data.id);
    if (notificationUpdate.error) {
      console.error("Could not update notification status:", notificationUpdate.error.message);
    }
  }

  return json({ application_id: inserted.data.id }, 201);
});
