# Berkshire Group visitor notification relay

This Cloudflare Worker keeps the rrring.cloud webhook private.

## Deploy

1. Create a Cloudflare Workers account/project.
2. Deploy `worker.js`.
3. Add a Worker secret named `RRRING_WEBHOOK_URL` containing the private rrring channel webhook URL.
4. Do **not** put the webhook URL in this repository.
5. After deployment, copy the Worker URL and add it to the Berkshire Group pages as the visitor notification endpoint.

The Worker only accepts POST requests from the Berkshire Group GitHub Pages origin and forwards the notification to rrring.cloud.
