# Supabase backend migration notes

## Safety rules
- Keep the current `main` branch and live GitHub Pages website unchanged until the new backend is deployed and tested.
- Preserve the existing employment form and admin-dashboard behaviour.
- Never put a Supabase service-role key, Turnstile secret, or other server secret in browser code or this repository.
- Employment applications contain sensitive personal information and ID images. Keep records private and ID files in a private storage bucket with short-lived signed URLs.

## Current frontend dependencies found
- `employment.html` submits multipart form data to the `submit-employment` Supabase Edge Function and expects JSON containing `application_id`.
- The employment form uses Cloudflare Turnstile and uploads front/back ID images.
- `admin.html` uses Supabase Auth password sign-in and calls the `admin-employment` Edge Function with actions `list`, `detail`, and `update-status`.
- The dashboard expects application rows with `id`, `created_at`, `status`, and `notification_status`; details include `payload`, `documents.front_url`, and `documents.back_url`.
- Existing browser files currently reference a different Supabase project. Do not switch those URLs until the equivalent functions, database schema, storage policies, Auth administrator account, and secrets are configured and tested in the new project.
- Visitor notification code uses separate endpoints. It is out of scope for this migration phase and should remain unchanged.

## Migration checklist
1. Confirm whether existing application records and uploaded documents must be migrated from the current backend.
2. Create the required schema and restrictive access policies in the new Supabase project.
3. Create private ID-document storage and the `submit-employment` and `admin-employment` Edge Functions.
4. Configure server-side secrets, including Turnstile verification, in Supabase Function secrets; do not commit them.
5. Create/verify the administrator Auth account and restrict dashboard actions to authorized administrators.
6. Test a sample application, uploads, admin sign-in, list/detail/status updates, and temporary document links on this branch.
7. Only after successful tests, open a pull request for review. Do not merge or publish automatically.
