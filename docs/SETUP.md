# Going live: Supabase + GitHub Pages

One-time setup, about 30–45 minutes. Steps marked **(you)** need your own accounts or
dashboards; Claude can do the rest once they're done.

## 1. Supabase project (you)

1. Sign up at <https://supabase.com> with an Aloha email and create a project.
   - **Name:** `aloha-costing`
   - **Region:** Mumbai (`ap-south-1`), closest to the team
   - Save the database password somewhere safe (a password manager). The app doesn't need it.
2. **SQL Editor → New query:** paste all of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
   You can run it again safely after future updates.

## 2. Sign-in settings (you)

In **Authentication**:

1. **Sign In / Providers → Email:** keep Email on. Turn **off** "Allow new users to sign up".
   (The app is invite-only; `npm run users` creates the accounts.)
2. **Emails → SMTP settings:** set up a real sender. Supabase's built-in sender only
   delivers to your own Supabase team members and only a few emails an hour, so PMs
   won't get their sign-in emails without this. Options:
   - Aloha's own mail server (Google Workspace / Microsoft 365 SMTP), or
   - a free tier of Resend or Brevo, sending from `no-reply@alohatechnology.com`.
3. **Emails → Templates → Magic Link:** replace the body with the text below, so the email
   has both a link and a 6-digit code (the code works if the email is opened on another device):

   ```html
   <h2>Sign in to Aloha Project Costing</h2>
   <p><a href="{{ .ConfirmationURL }}">Click here to sign in</a></p>
   <p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>If you didn't ask for this, ignore this email.</p>
   ```
4. **URL Configuration:**
   - **Site URL:** your GitHub Pages address, e.g. `https://<account>.github.io/aloha-costing/`
   - **Redirect URLs:** add that same address and `http://localhost:5180/`

## 3. Keys on your computer (you)

**Project Settings → API Keys.** Copy `.env.example` to `.env` in `D:\Aloha App` and paste in:

- `VITE_SUPABASE_URL`: the Project URL
- `VITE_SUPABASE_ANON_KEY`: the **publishable** (or `anon`) key. This one is designed to be public.
- `SUPABASE_SERVICE_ROLE_KEY`: the **secret** (or `service_role`) key. It gives full access,
  so it stays in `.env` only. Never paste it into chat, GitHub, or the app.

`.env` is git-ignored.

## 4. Load data and give people access

```bash
npm run import          # read data/inbox
npm run publish         # upload admin + per-PM snapshots
npm run users           # preview who gets access
npm run users -- --apply
npm run migrate -- --apply   # only if you created actions/contacts locally
```

Leadership emails go in `data/users.json` under `"leadership"`, e.g.
`{ "email": "ceo@alohatechnology.com", "name": "Asha" }`. Then run `npm run users -- --apply` again.

## 5. GitHub Pages (you, then Claude)

1. Use an **Aloha** GitHub account or organisation, not a personal one. Create an empty
   repository named `aloha-costing`. On the free plan it must be **public** for Pages; only
   code goes there, never data, and the build refuses to publish if it finds any.
2. **Settings → Pages → Source:** GitHub Actions.
3. **Settings → Secrets and variables → Actions → Variables:** add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the same values as in `.env`). Don't add the secret key.
4. Give Claude the repository URL. Claude connects it and pushes; the workflow tests,
   builds and deploys on every push to `main`.

## Monthly routine

1. Drop the new exports into `data/inbox/`.
2. `npm run import`, then check the numbers locally: `npm run dev:local`, or ask Claude.
3. `npm run publish`. Everyone sees the new month the next time they open the app.
4. Send the WhatsApp digests from the app's WhatsApp tab.
