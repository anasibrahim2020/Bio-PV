# Bio Nutrition — Payment Vouchers Portal · Setup Guide

A portal to document disbursements from the company bank account. **You (Anas)** create and approve every voucher; the **3 partners share one view-only account** to see all vouchers, attachments and details (full transparency).

---

## One-time setup

### 1) Create a new Supabase project
- Go to https://supabase.com → **New project** → pick a name like `bionutrition-pv` and the nearest region (Frankfurt / Bahrain).

### 2) Run the SQL
- In the project: **SQL Editor → New query** → paste the entire contents of [`supabase/setup-bionutrition.sql`](supabase/setup-bionutrition.sql) → **Run**.
- This creates the `requests` table + the attachments storage bucket + security policies (write = you only, read = all partners).

### 3) Create the user accounts
- **Authentication → Users → Add user** for each (Email + Password, and enable **Auto Confirm User**):

| Username     | Email (for Supabase)              | Access          | Who         |
|--------------|-----------------------------------|-----------------|-------------|
| `admin`      | `admin@bionutritionmedical.com`   | Full (approver) | You (Anas)  |
| `hassan`     | `hassan@bionutritionmedical.com`  | View + Acknowledge | Partner  |
| `abaza`      | `abaza@bionutritionmedical.com`   | View + Acknowledge | Partner  |
| `ahmednabel` | `ahmednabel@bionutritionmedical.com` | View + Acknowledge | Partner |

> Each partner has their **own** account and logs in with the **username** (not the email) + password. All four emails must be on the **same domain** `@bionutritionmedical.com`.

### Also run the acknowledgements SQL
In **SQL Editor → New query**, paste [`supabase/acknowledge.sql`](supabase/acknowledge.sql) → **Run**. It creates two tables: `voucher_acks` (each partner confirms/"acknowledges" they saw a transfer — the ledger shows how many of the 3 acknowledged, with the time of each) and `voucher_comments` (a public comment thread — anyone signed in can write, everyone sees all). Both are secured so a partner can only write as themselves and cannot edit vouchers.

### 4) Wire the keys into the app
- In Supabase: **Settings → API** → copy the **Project URL** and the **anon / publishable key**.
- Open [`assets/js/script-5.js`](assets/js/script-5.js) and put both values in place of:
  ```js
  const SUPABASE_URL = 'PASTE_YOUR_NEW_SUPABASE_URL_HERE';
  const SUPABASE_KEY = 'PASTE_YOUR_NEW_ANON_PUBLISHABLE_KEY_HERE';
  ```

### 5) Done
- Open `index.html` (or host it on any static host / Netlify) and log in as `anas`.

---

## Push notifications (partners get notified on every new voucher; you get notified on every acknowledgement)

### a) Run the SQL
In **SQL Editor → New query**, paste [`supabase/push-notifications.sql`](supabase/push-notifications.sql) → **Run**. Creates `push_subscriptions` (one row per device that turns notifications on), secured so each account only manages its own rows.

### b) Deploy the Edge Function
**Edge Functions → Create a new function** → name it `push-notify` → paste the contents of [`supabase/functions/push-notify/index.ts`](supabase/functions/push-notify/index.ts) → **Deploy**.

### c) Add 3 secrets
**Edge Functions → Secrets** → add:
```
VAPID_PUBLIC_KEY  = BACSmK7YzeoVimlqFhg7vEQe4-YvsqdyrUpF3DvWHE5psBSDGb7FPXJGxtPVaH1pIaR5t7b4YI-kwEjq4_MWd2M
VAPID_PRIVATE_KEY = Xmue44HanGIjbj7SHkuukW2bYFMiiXefIWNyIWE-PDU
VAPID_SUBJECT     = mailto:admin@bionutritionmedical.com
```
These two keys are already generated and matched to the `VAPID_PUBLIC_KEY` constant in `script-5.js` — just paste them as-is. (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are provided to every Edge Function automatically — nothing to add for those.)

If you ever need to replace these keys yourself with no tooling installed, generate a fresh pair at [vapidkeys.com](https://vapidkeys.com) and update both the 2 secrets here **and** the constant in `script-5.js` together — an old public key in the app talking to new private-key secrets will silently fail.

### d) Wire the 2 webhooks
**Database → Webhooks → Create a new webhook**, twice:

| Table | Event | Type | Edge Function |
|---|---|---|---|
| `requests` | `INSERT` | Supabase Edge Function | `push-notify` |
| `voucher_acks` | `INSERT` | Supabase Edge Function | `push-notify` |

### e) Try it
Log in on your phone, tap **Enable** on the "Enable Notifications" prompt that appears a couple seconds after you're in, then create (or have a partner acknowledge) a test voucher from another device — a notification should land within a few seconds.

**iPhone note**: push notifications only work if the partner opened the app from an icon on their **Home Screen** (Safari → Share → *Add to Home Screen*), not from a normal Safari tab or bookmark — this is an Apple platform rule for every website, not something specific to this app. Android works either way (installed or just open in Chrome).

---

## Partner names
Edit the display names in `USER_MAP` at the top of [`assets/js/script-5.js`](assets/js/script-5.js) (`name` and `name_en`). If you change usernames or emails:
1. Change them in `USER_MAP`.
2. Create the matching emails in Supabase Auth.
3. If you change **your** email, also change it in `setup-bionutrition.sql` (in two places: `requests_write_accountant` and `ra_write_accountant`) and re-run the SQL.

## Notes
- **Security is enforced at the database level**: even if someone tries to write outside the portal, the RLS policies block any write from an email other than yours.
- The Hajj/Umrah **cancellation / refund** page has been hidden — the portal is now **payment vouchers only**.
- Push notifications are set up per the section above; they're optional — the app works fully without them. `supabase/functions/notify/index.ts` (email/WhatsApp) is leftover from an unrelated project and isn't used.
