require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function visibleUntilIso() {
  return new Date(Date.now() + TWO_HOURS_MS).toISOString();
}

/** PostgREST / older DBs without optional migration columns */
function isOptionalColumnSchemaError(err) {
  const m = (err && err.message) || '';
  return (
    /schema cache/i.test(m) ||
    /could not find .* column/i.test(m) ||
    (/column/i.test(m) && /does not exist/i.test(m))
  );
}

function isOpenEmergencyStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'open' || s === 'dispatched';
}

function isPendingRequestStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'requested' || s === 'confirmed' || s === 'in_progress';
}

/** Admin data browser: table name → primary key + editable columns (service role updates). */
const ADMIN_TABLES = {
  profiles: {
    pk: 'user_id',
    editable: ['name', 'phone', 'address', 'role'],
  },
  healthcare_providers: {
    pk: 'provider_id',
    editable: [
      'name',
      'specialization',
      'license_number',
      'verified',
      'email',
      'phone',
      'address',
      'provider_user_id',
    ],
  },
  service_types: {
    pk: 'service_id',
    editable: ['service_name', 'base_price', 'duration_minutes'],
  },
  service_requests: {
    pk: 'request_id',
    editable: [
      'status',
      'location',
      'request_time',
      'provider_id',
      'service_id',
      'user_id',
      'location_lat',
      'location_lng',
      'eta_minutes',
      'dispatch_lat',
      'dispatch_lng',
      'updated_at',
      'visible_until',
      'route_points',
      'closed_at',
    ],
  },
  emergency_requests: {
    pk: 'emergency_id',
    editable: [
      'severity',
      'status',
      'location',
      'notes',
      'location_lat',
      'location_lng',
      'response_eta_minutes',
      'visible_until',
      'user_id',
    ],
  },
  payments: {
    pk: 'payment_id',
    editable: ['amount', 'method', 'status', 'request_id'],
  },
  prescriptions: {
    pk: 'prescription_id',
    editable: ['medicines', 'dosage', 'request_id'],
  },
  rating_feedback: {
    pk: 'feedback_id',
    editable: ['rating', 'comments', 'request_id'],
  },
  medical_records: {
    pk: 'record_id',
    editable: ['diagnosis', 'notes', 'record_date', 'user_id'],
  },
  provider_availability: {
    pk: 'availability_id',
    editable: ['provider_id', 'date', 'time_slot', 'is_available'],
  },
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ---------- Auth: verify Supabase JWT ---------- */
async function getUserFromRequest(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return { user: null, error: 'Missing Authorization bearer token' };
  }
  const token = header.slice(7);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: error?.message || 'Invalid session' };
  }
  return { user, error: null };
}

function requireAuth(req, res, next) {
  getUserFromRequest(req).then(({ user, error }) => {
    if (!user) {
      return res.status(401).json({ error: error || 'Unauthorized' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  getUserFromRequest(req).then(async ({ user, error }) => {
    if (!user) {
      return res.status(401).json({ error: error || 'Unauthorized' });
    }
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('role, user_id, name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = user;
    req.adminProfile = profile;
    next();
  });
}

/* ---------- Helpers ---------- */
async function fetchProvidersWithRatings() {
  const { data: providers, error: pErr } = await supabase
    .from('healthcare_providers')
    .select('*')
    .order('name');
  if (pErr) throw pErr;

  const { data: feedbackRows, error: fErr } = await supabase
    .from('rating_feedback')
    .select('rating, service_requests!inner(provider_id)');
  if (fErr) throw fErr;

  const byProvider = {};
  for (const row of feedbackRows || []) {
    const pid = row.service_requests?.provider_id;
    if (!pid) continue;
    if (!byProvider[pid]) byProvider[pid] = { sum: 0, n: 0 };
    byProvider[pid].sum += row.rating;
    byProvider[pid].n += 1;
  }

  return (providers || []).map((p) => {
    const agg = byProvider[p.provider_id];
    return {
      ...p,
      avg_rating: agg ? Math.round((agg.sum / agg.n) * 10) / 10 : null,
      review_count: agg?.n ?? 0,
    };
  });
}

/* ---------- Public / catalogue ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'CareConnect API' });
});

app.get('/api/providers', async (_req, res) => {
  try {
    const list = await fetchProvidersWithRatings();
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/services', async (_req, res) => {
  const { data, error } = await supabase
    .from('service_types')
    .select('*')
    .order('service_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/availability', async (req, res) => {
  const { provider_id, date } = req.query;
  if (!provider_id) {
    return res.status(400).json({ error: 'provider_id required' });
  }
  let q = supabase
    .from('provider_availability')
    .select('*')
    .eq('provider_id', provider_id)
    .eq('is_available', true)
    .order('date')
    .order('time_slot');
  if (date) q = q.eq('date', date);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ---------- Profile (USER) ---------- */
app.get('/api/me/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(404).json({ error: 'Profile not found; complete signup.' });
  }
  res.json(data);
});

app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { name, phone, address } = req.body;
  const patch = {};
  if (name != null) patch.name = name;
  if (phone != null) patch.phone = phone;
  if (address != null) patch.address = address;
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ---------- Service requests ---------- */
app.post('/api/requests', requireAuth, async (req, res) => {
  const {
    provider_id,
    service_id,
    location,
    request_time,
    location_lat,
    location_lng,
  } = req.body;
  if (!service_id || !location) {
    return res
      .status(400)
      .json({ error: 'service_id and location are required' });
  }
  const row = {
    user_id: req.user.id,
    provider_id: provider_id || null,
    service_id,
    location,
    status: 'requested',
    request_time: request_time || new Date().toISOString(),
    location_lat: location_lat ?? null,
    location_lng: location_lng ?? null,
    eta_minutes: provider_id ? 12 + Math.floor(Math.random() * 18) : null,
    visible_until: visibleUntilIso(),
    route_points: [],
  };
  const selectReq = `
      *,
      healthcare_providers (name, specialization),
      service_types (service_name, base_price, duration_minutes)
    `;
  let { data, error } = await supabase
    .from('service_requests')
    .insert([row])
    .select(selectReq)
    .single();
  if (error && isOptionalColumnSchemaError(error)) {
    const { visible_until: _v, route_points: _r, ...minimal } = row;
    ({ data, error } = await supabase
      .from('service_requests')
      .insert([minimal])
      .select(selectReq)
      .single());
  }
  if (error) {
    console.error('insert request', error);
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

app.get('/api/me/requests', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('service_requests')
    .select(
      `
      *,
      healthcare_providers (name, specialization),
      service_types (service_name, base_price, duration_minutes),
      payments (payment_id, amount, method, status),
      prescriptions (prescription_id, medicines, dosage),
      rating_feedback (feedback_id, rating, comments)
    `
    )
    .eq('user_id', req.user.id)
    .order('request_time', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** Simulated live tracking: nudges dispatch toward user location; stores route polyline until paid. */
app.get('/api/requests/:id/track', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: reqRow, error } = await supabase
    .from('service_requests')
    .select(
      `
      *,
      payments (payment_id)
    `
    )
    .eq('request_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });

  const pay = reqRow.payments;
  const hasPayment = Array.isArray(pay)
    ? pay.length > 0
    : pay != null && typeof pay === 'object';

  if (hasPayment) {
    return res.status(410).json({
      error: 'Live tracking is no longer available after payment.',
      tracking_closed: true,
    });
  }

  let {
    dispatch_lat,
    dispatch_lng,
    eta_minutes,
    location_lat,
    location_lng,
    route_points,
    status,
  } = reqRow;

  const destLat = location_lat ?? 13.0827;
  const destLng = location_lng ?? 80.2707;

  if (dispatch_lat == null || dispatch_lng == null) {
    dispatch_lat = destLat + 0.04;
    dispatch_lng = destLng + 0.04;
  } else {
    dispatch_lat += (destLat - dispatch_lat) * 0.22;
    dispatch_lng += (destLng - dispatch_lng) * 0.22;
  }

  eta_minutes = Math.max(
    2,
    (eta_minutes ?? 18) - Math.floor(2 + Math.random() * 3)
  );

  let pts = Array.isArray(route_points) ? [...route_points] : [];
  pts.push({
    lat: dispatch_lat,
    lng: dispatch_lng,
    t: new Date().toISOString(),
  });
  if (pts.length > 400) pts = pts.slice(-400);

  const updatePayload = {
    dispatch_lat,
    dispatch_lng,
    eta_minutes,
    updated_at: new Date().toISOString(),
    route_points: pts,
  };

  const { error: upErr } = await supabase
    .from('service_requests')
    .update(updatePayload)
    .eq('request_id', id);
  if (upErr) {
    const { dispatch_lat: d1, dispatch_lng: d2, eta_minutes: e2, updated_at: u2 } =
      updatePayload;
    await supabase
      .from('service_requests')
      .update({
        dispatch_lat: d1,
        dispatch_lng: d2,
        eta_minutes: e2,
        updated_at: u2,
      })
      .eq('request_id', id);
  }

  const routeLine = pts.map((p) => [p.lat, p.lng]);

  res.json({
    request_id: id,
    status,
    eta_minutes,
    destination: { lat: destLat, lng: destLng },
    ambulance: { lat: dispatch_lat, lng: dispatch_lng },
    route: routeLine,
    tracking_closed: false,
    updated_at: new Date().toISOString(),
  });
});

app.patch('/api/requests/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const next = String(status).toLowerCase();
  const { data: existing, error: fetchErr } = await supabase
    .from('service_requests')
    .select('request_id, status, payments(payment_id)')
    .eq('request_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const current = String(existing.status).toLowerCase();
  const p = existing.payments;
  const paid = Array.isArray(p)
    ? p.length > 0
    : p != null && typeof p === 'object' && Object.keys(p).length > 0;

  if (next === 'cancelled') {
    const cancellable = ['requested', 'in_progress', 'confirmed'];
    if (!cancellable.includes(current)) {
      return res
        .status(400)
        .json({ error: 'This visit cannot be cancelled in its current state.' });
    }
    if (paid) {
      return res
        .status(400)
        .json({ error: 'Cannot cancel after payment. Contact support if needed.' });
    }
  }

  const { data, error } = await supabase
    .from('service_requests')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('request_id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ---------- Emergency ---------- */
app.post('/api/emergency', requireAuth, async (req, res) => {
  const {
    severity,
    location,
    notes,
    location_lat,
    location_lng,
  } = req.body;
  const sev = severity || 'high';
  const now = Date.now();
  let { data: activeRows, error: activeErr } = await supabase
    .from('emergency_requests')
    .select('emergency_id, status, created_at, visible_until')
    .eq('user_id', req.user.id)
    .in('status', ['open', 'dispatched'])
    .order('created_at', { ascending: false });
  if (activeErr && isOptionalColumnSchemaError(activeErr)) {
    ({ data: activeRows, error: activeErr } = await supabase
      .from('emergency_requests')
      .select('emergency_id, status, created_at')
      .eq('user_id', req.user.id)
      .in('status', ['open', 'dispatched'])
      .order('created_at', { ascending: false }));
  }
  if (activeErr) return res.status(500).json({ error: activeErr.message });

  const activeEmergencyIds = (activeRows || [])
    .filter((e) => {
      if (!isOpenEmergencyStatus(e.status)) return false;
      if (Object.prototype.hasOwnProperty.call(e, 'visible_until')) {
        return e.visible_until == null || new Date(e.visible_until).getTime() > now;
      }
      return (
        e.created_at != null &&
        new Date(e.created_at).getTime() >= now - TWO_HOURS_MS
      );
    })
    .map((e) => e.emergency_id);

  // Keep only one active emergency at a time: resolve older active ones first.
  if (activeEmergencyIds.length > 0) {
    const { error: closeErr } = await supabase
      .from('emergency_requests')
      .update({ status: 'resolved' })
      .in('emergency_id', activeEmergencyIds);
    if (closeErr) return res.status(500).json({ error: closeErr.message });
  }

  const row = {
    user_id: req.user.id,
    severity: sev,
    status: 'dispatched',
    location: location || 'GPS pending',
    notes: notes || null,
    location_lat: location_lat ?? null,
    location_lng: location_lng ?? null,
    response_eta_minutes: 7 + Math.floor(Math.random() * 12),
    visible_until: visibleUntilIso(),
  };
  let { data, error } = await supabase
    .from('emergency_requests')
    .insert([row])
    .select()
    .single();
  if (error && isOptionalColumnSchemaError(error)) {
    const { visible_until: _v, ...minimal } = row;
    ({ data, error } = await supabase
      .from('emergency_requests')
      .insert([minimal])
      .select()
      .single());
  }
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.get('/api/me/emergencies', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('emergency_requests')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ---------- Medical records ---------- */
app.get('/api/me/medical-records', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('medical_records')
    .select('*')
    .eq('user_id', req.user.id)
    .order('record_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/me/medical-records', requireAuth, async (req, res) => {
  const { diagnosis, notes, record_date } = req.body;
  if (!diagnosis) {
    return res.status(400).json({ error: 'diagnosis required' });
  }
  const { data, error } = await supabase
    .from('medical_records')
    .insert([
      {
        user_id: req.user.id,
        diagnosis,
        notes: notes || null,
        record_date: record_date || new Date().toISOString().slice(0, 10),
      },
    ])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

/* ---------- Payments & prescriptions & feedback ---------- */
app.post('/api/payments', requireAuth, async (req, res) => {
  const { request_id, amount, method } = req.body;
  if (!request_id || amount == null || !method) {
    return res
      .status(400)
      .json({ error: 'request_id, amount, and method required' });
  }
  const { data: sr } = await supabase
    .from('service_requests')
    .select('request_id')
    .eq('request_id', request_id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (!sr) return res.status(404).json({ error: 'Service request not found' });

  const { data, error } = await supabase
    .from('payments')
    .insert([
      {
        request_id,
        amount,
        method,
        status: 'completed',
      },
    ])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Payment already exists for request' });
    }
    return res.status(500).json({ error: error.message });
  }

  const completedPatch = {
    status: 'completed',
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await supabase
    .from('service_requests')
    .update(completedPatch)
    .eq('request_id', request_id);
  if (upErr && isOptionalColumnSchemaError(upErr)) {
    const { closed_at: _c, ...noClosed } = completedPatch;
    const { error: fallbackErr } = await supabase
      .from('service_requests')
      .update(noClosed)
      .eq('request_id', request_id);
    if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
  } else if (upErr) {
    return res.status(500).json({ error: upErr.message });
  }

  res.status(201).json(data);
});

/** Demo: attach prescription to own completed-style request */
app.post('/api/prescriptions', requireAuth, async (req, res) => {
  const { request_id, medicines, dosage } = req.body;
  if (!request_id || !medicines || !dosage) {
    return res
      .status(400)
      .json({ error: 'request_id, medicines, dosage required' });
  }
  const { data: sr } = await supabase
    .from('service_requests')
    .select('request_id')
    .eq('request_id', request_id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (!sr) return res.status(404).json({ error: 'Service request not found' });

  const { data, error } = await supabase
    .from('prescriptions')
    .insert([{ request_id, medicines, dosage }])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ error: 'Prescription already exists for request' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  const { request_id, rating, comments } = req.body;
  if (!request_id || rating == null) {
    return res.status(400).json({ error: 'request_id and rating required' });
  }
  const { data: sr } = await supabase
    .from('service_requests')
    .select('request_id')
    .eq('request_id', request_id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (!sr) return res.status(404).json({ error: 'Service request not found' });

  const { data, error } = await supabase
    .from('rating_feedback')
    .insert([{ request_id, rating: Number(rating), comments: comments || null }])
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Feedback already submitted' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

/* ---------- Analytics dashboard (assignment / admin style) ---------- */
app.get('/api/analytics/summary', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const now = Date.now();
    const twoHoursAgo = new Date(now - TWO_HOURS_MS).toISOString();

    let myEmergencies = [];
    let { data: emergencyRows, error: emErr } = await supabase
      .from('emergency_requests')
      .select('status, visible_until, created_at')
      .eq('user_id', userId);
    if (emErr && isOptionalColumnSchemaError(emErr)) {
      ({ data: emergencyRows, error: emErr } = await supabase
        .from('emergency_requests')
        .select('status, created_at')
        .eq('user_id', userId));
    }
    if (emErr) return res.status(500).json({ error: emErr.message });
    myEmergencies = emergencyRows || [];

    const myOpenEmergencies = myEmergencies.filter((e) => {
      if (!isOpenEmergencyStatus(e.status)) return false;
      if (Object.prototype.hasOwnProperty.call(e, 'visible_until')) {
        return e.visible_until == null || new Date(e.visible_until).getTime() > now;
      }
      return e.created_at != null && new Date(e.created_at).getTime() >= new Date(twoHoursAgo).getTime();
    }).length;

    const { data: myRequests, error: reqErr } = await supabase
      .from('service_requests')
      .select('status, eta_minutes, request_time')
      .eq('user_id', userId);
    if (reqErr) return res.status(500).json({ error: reqErr.message });

    const totalRequests = myRequests?.length ?? 0;
    const completed =
      myRequests?.filter((r) => String(r.status || '').toLowerCase() === 'completed')
        .length ?? 0;
    const pending =
      myRequests?.filter((r) => isPendingRequestStatus(r.status)).length ?? 0;

    const etas = (myRequests || [])
      .filter((r) => isPendingRequestStatus(r.status))
      .map((r) => r.eta_minutes)
      .filter((n) => n != null);
    const avgEta =
      etas.length > 0
        ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length)
        : null;

    const { count: platformRequests, error: pReqErr } = await supabase
      .from('service_requests')
      .select('*', { count: 'exact', head: true });
    if (pReqErr) return res.status(500).json({ error: pReqErr.message });

    const { count: verifiedProviders, error: vErr } = await supabase
      .from('healthcare_providers')
      .select('*', { count: 'exact', head: true })
      .eq('verified', true);
    if (vErr) return res.status(500).json({ error: vErr.message });

    res.json({
      user: {
        open_emergencies: myOpenEmergencies ?? 0,
        total_requests: totalRequests,
        completed_requests: completed,
        pending_requests: pending,
        avg_eta_minutes: avgEta,
      },
      platform: {
        total_service_requests: platformRequests ?? 0,
        verified_providers: verifiedProviders ?? 0,
      },
      sla_note:
        'ETA averages are calculated from pending requests and active emergencies only.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Admin (master dashboard; JWT + profiles.role = admin) ---------- */

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({
    user_id: req.user.id,
    email: req.user.email,
    name: req.adminProfile?.name,
    role: req.adminProfile?.role,
  });
});

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const [
      { count: users },
      { count: admins },
      { count: providers },
      { count: services },
      { count: requests },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
      supabase.from('healthcare_providers').select('*', { count: 'exact', head: true }),
      supabase.from('service_types').select('*', { count: 'exact', head: true }),
      supabase.from('service_requests').select('*', { count: 'exact', head: true }),
    ]);
    res.json({
      profiles: users ?? 0,
      admins: admins ?? 0,
      healthcare_providers: providers ?? 0,
      service_types: services ?? 0,
      service_requests: requests ?? 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const { data: list, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) return res.status(500).json({ error: error.message });
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('*');
  if (pErr) return res.status(500).json({ error: pErr.message });
  const pmap = Object.fromEntries((profiles || []).map((p) => [p.user_id, p]));
  const merged = (list.users || []).map((u) => {
    const pr = pmap[u.id] || {};
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      name: pr.name ?? null,
      phone: pr.phone ?? null,
      address: pr.address ?? null,
      role: pr.role ?? 'user',
    };
  });
  res.json(merged);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { email, password, full_name, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  let r = 'user';
  if (role === 'admin') r = 'admin';
  else if (role === 'provider') r = 'provider';
  const { data, error } = await supabase.auth.admin.createUser({
    email: String(email).trim(),
    password: String(password),
    email_confirm: true,
    user_metadata: {
      full_name: full_name || email.split('@')[0],
      name: full_name || email.split('@')[0],
    },
  });
  if (error) return res.status(400).json({ error: error.message });
  const uid = data.user.id;
  const displayName = full_name || email.split('@')[0];
  const { error: upErr } = await supabase.from('profiles').upsert(
    {
      user_id: uid,
      name: displayName,
      role: r,
    },
    { onConflict: 'user_id' },
  );
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.status(201).json({
    id: uid,
    email: data.user.email,
    role: r,
    name: displayName,
  });
});

app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (role !== 'admin' && role !== 'user' && role !== 'provider') {
    return res.status(400).json({ error: 'role must be admin, user, or provider' });
  }
  const next = role;
  const { data: target } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', id)
    .maybeSingle();
  if (!target) return res.status(404).json({ error: 'Profile not found' });

  if (target.role === 'admin' && next !== 'admin') {
    const { count, error: cErr } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'admin');
    if (cErr) return res.status(500).json({ error: cErr.message });
    if ((count ?? 0) <= 1) {
      return res
        .status(400)
        .json({ error: 'Cannot remove the last administrator account.' });
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ role: next })
    .eq('user_id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/admin/providers', requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from('healthcare_providers')
    .select('*')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/providers', requireAdmin, async (req, res) => {
  const { name, specialization, license_number, verified } = req.body;
  if (!name || !specialization || !license_number) {
    return res
      .status(400)
      .json({ error: 'name, specialization, and license_number required' });
  }
  const { data, error } = await supabase
    .from('healthcare_providers')
    .insert([
      {
        name,
        specialization,
        license_number,
        verified: Boolean(verified),
      },
    ])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.patch('/api/admin/providers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, specialization, license_number, verified } = req.body;
  const patch = {};
  if (name != null) patch.name = name;
  if (specialization != null) patch.specialization = specialization;
  if (license_number != null) patch.license_number = license_number;
  if (verified != null) patch.verified = Boolean(verified);
  const { data, error } = await supabase
    .from('healthcare_providers')
    .update(patch)
    .eq('provider_id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

app.get('/api/admin/service-types', requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from('service_types')
    .select('*')
    .order('service_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/service-types', requireAdmin, async (req, res) => {
  const { service_name, base_price, duration_minutes } = req.body;
  if (service_name == null || base_price == null) {
    return res.status(400).json({ error: 'service_name and base_price required' });
  }
  const { data, error } = await supabase
    .from('service_types')
    .insert([
      {
        service_name,
        base_price: Number(base_price),
        duration_minutes: duration_minutes != null ? Number(duration_minutes) : 30,
      },
    ])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.patch('/api/admin/service-types/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { service_name, base_price, duration_minutes } = req.body;
  const patch = {};
  if (service_name != null) patch.service_name = service_name;
  if (base_price != null) patch.base_price = Number(base_price);
  if (duration_minutes != null) patch.duration_minutes = Number(duration_minutes);
  const { data, error } = await supabase
    .from('service_types')
    .update(patch)
    .eq('service_id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

/* ---------- Provider self-service ---------- */
app.post('/api/provider/register', async (req, res) => {
  const {
    email,
    password,
    full_name,
    phone,
    address,
    specialization,
    license_number,
  } = req.body;
  if (!email || !password || !full_name || !specialization || !license_number) {
    return res.status(400).json({
      error:
        'email, password, full_name, specialization, and license_number are required',
    });
  }
  const emailTrim = String(email).trim();
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email: emailTrim,
    password: String(password),
    email_confirm: true,
    user_metadata: {
      full_name: String(full_name).trim(),
      name: String(full_name).trim(),
    },
  });
  if (cErr) return res.status(400).json({ error: cErr.message });
  const uid = created.user.id;

  const { error: pErr } = await supabase
    .from('profiles')
    .update({
      name: String(full_name).trim(),
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      role: 'provider',
    })
    .eq('user_id', uid);
  if (pErr) return res.status(500).json({ error: pErr.message });

  const { data: hp, error: hErr } = await supabase
    .from('healthcare_providers')
    .insert([
      {
        name: String(full_name).trim(),
        specialization: String(specialization).trim(),
        license_number: String(license_number).trim(),
        verified: false,
        provider_user_id: uid,
        phone: phone ? String(phone).trim() : null,
        address: address ? String(address).trim() : null,
        email: emailTrim,
      },
    ])
    .select()
    .single();
  if (hErr) return res.status(400).json({ error: hErr.message });

  res.status(201).json({ provider_id: hp.provider_id, user_id: uid });
});

app.get('/api/me/provider', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('healthcare_providers')
    .select('*')
    .eq('provider_user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(404).json({ error: 'No provider profile for this account' });
  }
  res.json(data);
});

app.get('/api/me/provider/requests', requireAuth, async (req, res) => {
  const { data: hp, error: hErr } = await supabase
    .from('healthcare_providers')
    .select('provider_id')
    .eq('provider_user_id', req.user.id)
    .maybeSingle();
  if (hErr) return res.status(500).json({ error: hErr.message });
  if (!hp) {
    return res.status(404).json({ error: 'No provider profile for this account' });
  }

  const { data, error } = await supabase
    .from('service_requests')
    .select(
      `
      *,
      service_types (service_name, base_price)
    `
    )
    .eq('provider_id', hp.provider_id)
    .order('request_time', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

/* ---------- Admin: browse & edit any whitelisted table ---------- */
app.get('/api/admin/tables', requireAdmin, (_req, res) => {
  res.json({ tables: Object.keys(ADMIN_TABLES) });
});

app.get('/api/admin/tables/:table/rows', requireAdmin, async (req, res) => {
  const table = req.params.table;
  const meta = ADMIN_TABLES[table];
  if (!meta) return res.status(404).json({ error: 'Unknown table' });
  const { data, error } = await supabase.from(table).select('*').limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

app.patch('/api/admin/tables/:table/rows', requireAdmin, async (req, res) => {
  const table = req.params.table;
  const meta = ADMIN_TABLES[table];
  if (!meta) return res.status(404).json({ error: 'Unknown table' });
  const pkVal = req.body?.[meta.pk];
  if (pkVal == null || pkVal === '') {
    return res.status(400).json({ error: `Body must include primary key "${meta.pk}"` });
  }
  const patch = { ...req.body };
  delete patch[meta.pk];
  const allowed = {};
  for (const k of meta.editable) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) allowed[k] = patch[k];
  }
  if (Object.keys(allowed).length === 0) {
    return res.status(400).json({ error: 'No editable fields to update' });
  }
  if (table === 'profiles' && allowed.role != null) {
    const r = allowed.role;
    if (r !== 'admin' && r !== 'user' && r !== 'provider') {
      return res.status(400).json({ error: 'Invalid role' });
    }
  }
  const { data, error } = await supabase
    .from(table)
    .update(allowed)
    .eq(meta.pk, pkVal)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Row not found' });
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`CareConnect API listening on http://localhost:${PORT}`);
});
