-- CareConnect DEMO data: patients, bookings, emergencies, records, payments (Chennai-area coords)
--
-- Before running: at least one auth.users row (sign up in the app).
-- If profiles row is missing (old accounts, trigger off), it is created in this script.
-- Re-runnable: removes old demo rows for the same user (locations/notes prefixed with [DEMO]).

DO $$
DECLARE
  uid uuid;
  prov_amb uuid;
  prov_gp uuid;
  sid_amb uuid;
  sid_nurse uuid;
  sid_tele uuid;
  req_done uuid;
  req_progress uuid;
  req_new uuid;
  req_rated uuid;
BEGIN
  SELECT
    id INTO uid
  FROM
    auth.users
  ORDER BY
    created_at ASC
  LIMIT
    1;

  IF uid IS NULL THEN
    RAISE NOTICE 'CareConnect demo seed skipped: no auth user. Sign up in the app, then run this script again.';
    RETURN;
  END IF;

  /*
   * Ensure public.profiles row exists (FK for service_requests etc.).
   * Handles users created before handle_new_user trigger or manual auth inserts.
   */
  INSERT INTO
    public.profiles (user_id, name, phone, address)
  VALUES
    (
      uid,
      'Demo Patient — Arun',
      '+91 98765 43210',
      '12 Lake View Rd, Adyar, Chennai 600020'
    )
  ON CONFLICT (user_id) DO UPDATE
  SET
    name = coalesce(nullif(trim(profiles.name), ''), excluded.name),
    phone = coalesce(nullif(trim(profiles.phone), ''), excluded.phone),
    address = coalesce(nullif(trim(profiles.address), ''), excluded.address);

  SELECT
    p.provider_id INTO prov_amb
  FROM
    public.healthcare_providers p
  WHERE
    p.name ilike '%apollo%'
    OR p.name ilike '%paramedic%'
  ORDER BY
    p.verified DESC
  LIMIT
    1;

  SELECT
    p.provider_id INTO prov_gp
  FROM
    public.healthcare_providers p
  WHERE
    p.name ilike '%meera%'
    OR p.specialization ilike '%general%'
  ORDER BY
    p.verified DESC
  LIMIT
    1;

  IF prov_amb IS NULL THEN
    SELECT
      provider_id INTO prov_amb
    FROM
      public.healthcare_providers
    WHERE
      verified
    LIMIT
      1;
  END IF;

  IF prov_gp IS NULL THEN
    prov_gp := prov_amb;
  END IF;

  SELECT
    service_id INTO sid_amb
  FROM
    public.service_types
  WHERE
    service_name ilike '%ambulance%'
  LIMIT
    1;

  SELECT
    service_id INTO sid_nurse
  FROM
    public.service_types
  WHERE
    service_name ilike '%nursing%'
  LIMIT
    1;

  SELECT
    service_id INTO sid_tele
  FROM
    public.service_types
  WHERE
    service_name ilike '%teleconsult%'
  LIMIT
    1;

  IF sid_amb IS NULL OR sid_nurse IS NULL OR sid_tele IS NULL THEN
    RAISE EXCEPTION 'Demo seed needs service_types from main migration (ambulance, nursing, teleconsult).';
  END IF;

  /* Remove previous demo rows for this user */
  DELETE FROM public.service_requests
  WHERE
    user_id = uid
    AND location like '[DEMO]%';

  DELETE FROM public.emergency_requests
  WHERE
    user_id = uid
    AND coalesce(notes, '') like '[DEMO]%';

  DELETE FROM public.medical_records
  WHERE
    user_id = uid
    AND coalesce(notes, '') like '[DEMO]%';

  /* ---- service_requests: patient coords + ambulance dispatch simulation ---- */
  INSERT INTO
    public.service_requests (
      request_time,
      status,
      location,
      user_id,
      provider_id,
      service_id,
      location_lat,
      location_lng,
      eta_minutes,
      dispatch_lat,
      dispatch_lng
    )
  VALUES
    (
      now() - interval '5 days',
      'completed',
      '[DEMO] 12 Lake View Rd, Adyar — home pickup',
      uid,
      prov_amb,
      sid_amb,
      13.0067,
      80.2534,
      0,
      13.0067,
      80.2534
    )
  RETURNING
    request_id INTO req_done;

  INSERT INTO
    public.service_requests (
      request_time,
      status,
      location,
      user_id,
      provider_id,
      service_id,
      location_lat,
      location_lng,
      eta_minutes,
      dispatch_lat,
      dispatch_lng
    )
  VALUES
    (
      now() - interval '2 hours',
      'in_progress',
      '[DEMO] 4th Main Rd, Velachery — nursing visit',
      uid,
      prov_gp,
      sid_nurse,
      12.9815,
      80.2209,
      14,
      12.995,
      80.235
    )
  RETURNING
    request_id INTO req_progress;

  INSERT INTO
    public.service_requests (
      request_time,
      status,
      location,
      user_id,
      provider_id,
      service_id,
      location_lat,
      location_lng,
      eta_minutes,
      dispatch_lat,
      dispatch_lng
    )
  VALUES
    (
      now() - interval '15 minutes',
      'requested',
      '[DEMO] Poonamallee High Rd, near Koyambedu — awaiting assignment',
      uid,
      prov_amb,
      sid_amb,
      13.0832,
      80.2085,
      22,
      13.105,
      80.245
    )
  RETURNING
    request_id INTO req_new;

  INSERT INTO
    public.service_requests (
      request_time,
      status,
      location,
      user_id,
      provider_id,
      service_id,
      location_lat,
      location_lng,
      eta_minutes,
      dispatch_lat,
      dispatch_lng
    )
  VALUES
    (
      now() - interval '8 days',
      'completed',
      '[DEMO] Cathedral Rd, Gopalapuram — teleconsult follow-up',
      uid,
      prov_gp,
      sid_tele,
      13.0502,
      80.2581,
      0,
      13.0502,
      80.2581
    )
  RETURNING
    request_id INTO req_rated;

  INSERT INTO
    public.payments (amount, method, status, request_id)
  VALUES
    (2499.00, 'upi', 'completed', req_done),
    (399.00, 'card', 'completed', req_rated);

  INSERT INTO
    public.prescriptions (medicines, dosage, request_id)
  VALUES
    (
      'Paracetamol 500mg, ORS sachets',
      'Paracetamol 1 tab after food if fever > 100.4°F; ORS as directed',
      req_done
    ),
    (
      'Azithromycin 500mg (course)',
      'Once daily for 3 days — completed with televisit',
      req_rated
    );

  INSERT INTO
    public.rating_feedback (rating, comments, request_id)
  VALUES
    (
      5,
      '[DEMO] Ambulance arrived quickly; crew was calm and professional.',
      req_done
    ),
    (
      4,
      '[DEMO] Clear teleconsult; would use again for follow-up.',
      req_rated
    );

  INSERT INTO
    public.emergency_requests (
      severity,
      status,
      user_id,
      location,
      notes,
      location_lat,
      location_lng,
      response_eta_minutes
    )
  VALUES
    (
      'high',
      'closed',
      uid,
      '[DEMO] Anna Salai, near Teynampet signal',
      '[DEMO] Fall at home — spouse called; unit cleared after assessment.',
      13.0328,
      80.2486,
      9
    ),
    (
      'critical',
      'dispatched',
      uid,
      '[DEMO] OMR, Sholinganallur junction',
      '[DEMO] Chest pain — golden hour dispatch (simulated demo).',
      12.9438,
      80.2403,
      6
    );

  INSERT INTO
    public.medical_records (diagnosis, notes, record_date, user_id)
  VALUES
    (
      'Hypertension — stable on medication',
      '[DEMO] BP 128/82 at last nurse visit; continue current Rx.',
      current_date - 40,
      uid
    ),
    (
      'Type 2 diabetes — diet counseling',
      '[DEMO] HbA1c trending down; reduce evening carbs.',
      current_date - 120,
      uid
    ),
    (
      'Seasonal allergic rhinitis',
      '[DEMO] Antihistamine as needed; avoid early morning pollen exposure.',
      current_date - 14,
      uid
    );

  RAISE NOTICE 'CareConnect demo seed OK for user % (request_ids + emergencies + records + payments + prescriptions + ratings).', uid;
END $$;

