# Berkshire Group 01 — new Supabase backend setup

This guide is for the new project at `https://dolzafpaqbhonbcrmhqv.supabase.co`. The live site remains unchanged until the branch is reviewed and tested.

## 1. Create the database and private storage

1. Open the new project in Supabase Dashboard.
2. Open **SQL Editor** and run the contents of `supabase/migrations/202610240001_employment_applications.sql`.
3. In **Storage**, confirm `employment-id-documents` exists and is **Private**.

The migration intentionally creates no public/authenticated-user policies for application rows or ID files. Edge Functions access them using the server-side service-role key.

## 2. Configure Cloudflare Turnstile

The existing form already has its public Turnstile site key. In Cloudflare Turnstile, find the matching widget and copy its **secret key**. Never put the secret in GitHub or HTML.

## 3. Deploy the two Edge Functions

From a terminal with the Supabase CLI installed, in a local clone of this repository on branch `feature/supabase-backend-migration`, run:

```sh
supabase login
supabase link --project-ref dolzafpaqbhonbcrmhqv
supabase functions deploy submit-employment --no-verify-jwt
supabase functions deploy admin-employment --no-verify-jwt
```

The submission endpoint has no user session, so its function validates Turnstile itself. The admin endpoint validates the Supabase access token and checks a server-side email allowlist. Keep those checks in the function.

Set the Turnstile secret (replace the placeholder locally; don't commit it):

```sh
supabase secrets set TURNSTILE_SECRET_KEY=your_turnstile_secret_here
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never paste the service-role key into browser code or commit it to GitHub.

## 4. Create the administrator account

1. In the new project's **Authentication → Users**, create a user with an email you control and a strong, unique password.
2. Set the `ADMIN_EMAILS` Edge Function secret to that exact email. Multiple admin emails can be comma-separated.

```sh
supabase secrets set ADMIN_EMAILS=your-real-admin-email@example.com
```

Replace the example with your actual admin email before running it. Only emails in this server-side secret can use the admin function.

## 5. Test before changing the live pages

Test using a local copy or preview of the branch. Confirm:
- A valid application with two supported ID files submits.
- Missing/invalid Turnstile, missing files, unsupported file types and oversized files are rejected.
- The application appears after signing in with the allowlisted administrator account.
- A non-allowlisted account gets an authorization error.
- Details show submitted form fields and both temporary ID links expire after about 60 seconds.
- Status changes persist after refresh.
- The separate visitor-relay script/configuration is unchanged.

## 6. Security and release notes

- Application payload contains sensitive data, including Social Security numbers. Never log it or expose it through public database policies.
- Keep the ID bucket private. Do not create public URLs or broad storage policies.
- Browser pages use only the publishable key; service-role key and Turnstile secret remain server-side.
- `notification_status` is initialized as `not_configured`. This migration does not configure application email notifications and does not change the separate visitor-relay system.
- Review and test the branch before opening/merging a pull request. Do not change production until the owner approves the tested result.
