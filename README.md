# CareConnect - On Demand HealthCare Service

On-demand healthcare stack aligned with the **CareConnect / DA1** brief (booking, emergency dispatch, tracking, medical history) and the **normalized healthcare schema** (ten core tables, BCNF fixes, RLS).

## Stacks

- **Next.js** (`web/`) — dark, high-contrast UI with large tap targets
- **Node + Express** (`backend/`) — REST API with JWT verification via Supabase Auth
- **Supabase** — PostgreSQL, Auth, optional Realtime for live GPS (commented in migration)

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the migration file:

   `supabase/migrations/20250329120000_careconnect_normalized.sql`

   If you already have conflicting table names from an older CareConnect prototype, back up data and drop or rename those tables first.

3. Confirm **Auth → Providers → Email** is enabled.

4. Copy **Project URL**, **anon key**, and **service_role** key from Project Settings → API.

5. Run the admin-role migration:

   `supabase/migrations/20250329150000_profiles_role_admin.sql`

6. **Promote your first administrator** (SQL Editor), using your own `auth.users` id or email:

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = (select id from auth.users order by created_at limit 1);
   ```

   Then open **`/admin/login`** in the Next app (also linked from the home page footer). Patient login remains at **`/login`**.

### Demo data (optional)

1. Sign up once in the app (creates `auth.users`; the seed script also ensures a `profiles` row if yours is missing).
2. In the SQL Editor, run  
   `supabase/migrations/20250329140000_demo_patient_ambulance_seed.sql`  
   It attaches demo **service requests** (Chennai-area patient + simulated ambulance coordinates), **payments**, **prescriptions**, **ratings**, **emergencies**, and **medical records** to the **first** account in `auth.users`. Rows are tagged with `[DEMO]` so you can re-run the script safely.

### 2. Backend

```bash
cd backend
copy .env.example .env
# Edit .env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
node server.js
```

API listens on `http://localhost:5000`.

### 3. Next.js frontend

```bash
cd web
copy .env.local.example .env.local
# Set NEXT_PUBLIC_* from Supabase; NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev
```

Open `http://localhost:3000`.

## Features implemented

- **Admin master dashboard** (`/admin`, `/admin/login`) — manage users (invite + assign admin), facilities (`healthcare_providers`), and service catalog (`service_types`). Protected by `profiles.role = 'admin'` and Node API routes under `/api/admin/*`.
- **Auth** — Supabase email/password; `profiles` row created by trigger on signup.
- **Catalogue** — `healthcare_providers`, `service_types`, `provider_availability` (unique slot per doc).
- **Bookings** — `service_requests` with optional GPS; pay and rate flows use `payments` and `rating_feedback` (one per request).
- **Emergency** — `emergency_requests` with severity and simulated ETA.
- **Records** — `medical_records` per user.
- **Tracking** — polling API that simulates moving “ambulance” coordinates toward the patient (swap in Realtime + real GPS when ready).
- **Analytics** — `/api/analytics/summary` for dashboard metrics.

## Legacy Vite app

The older `frontend/` Vite client is unchanged. Coursework and demos should use `web/` + `backend/` + Supabase as described above.
