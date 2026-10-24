export default {
  async fetch(request, env) {
    const allowedOrigin = "https://lindawyatt061-glitch.github.io";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Access-Control-Allow-Origin": allowedOrigin }
      });
    }

    const origin = request.headers.get("Origin") || "";
    if (origin !== allowedOrigin) {
      return new Response("Forbidden", { status: 403 });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const payload = {
      title: "New Berkshire Group visitor",
      body: String(data.body || "A visitor opened the Berkshire Group website."),
      url: String(data.url || "")
    };

    const response = await fetch(env.RRRING_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return new Response(
      response.ok ? "OK" : "Notification failed",
      {
        status: response.ok ? 200 : 502,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Content-Type": "text/plain"
        }
      }
    );
  }
};
