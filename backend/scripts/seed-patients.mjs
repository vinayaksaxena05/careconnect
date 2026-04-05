/**
 * Creates ~50 demo patient accounts with profiles, medical history, and sample visits.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in backend/.env
 *
 * Run: node scripts/seed-patients.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const sb = createClient(url, key);

const first = [
  'Ananya', 'Rahul', 'Kavitha', 'Suresh', 'Meena', 'Vikram', 'Deepa', 'Kiran',
  'Lakshmi', 'Arvind', 'Sunita', 'Naveen', 'Padma', 'Girish', 'Revathi', 'Manoj',
  'Shanti', 'Prakash', 'Uma', 'Dinesh', 'Radha', 'Srinivas', 'Kalpana', 'Harish',
  'Vimala', 'Ashwin', 'Jyoti', 'Ramesh', 'Nithya', 'Karthik', 'Sowmya', 'Bharath',
  'Indira', 'Ganesh', 'Malathi', 'Senthil', 'Archana', 'Varun', 'Yamini', 'Pradeep',
  'Keerthi', 'Murali', 'Swathi', 'Raghav', 'Tanvi', 'Siddharth', 'Priyanka', 'Aditya',
  'Neha', 'Rohit',
];
const last = [
  'Iyer', 'Menon', 'Reddy', 'Nair', 'Krishnan', 'Subramanian', 'Pillai', 'Rao',
  'Desai', 'Kapoor', 'Verma', 'Joshi', 'Patel', 'Sharma', 'Singh', 'Kulkarni',
  'Bose', 'Ghosh', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Das', 'Sen', 'Roy',
  'Thomas', 'George', 'Mathew', 'Joseph', 'Fernandes', "D'Souza", 'Pereira', 'Rodrigues',
  'Khan', 'Ahmed', 'Hussain', 'Malik', 'Sheikh', 'Ansari', 'Bhat', 'Kaul',
  'Murthy', 'Shetty', 'Hegde', 'Kamath', 'Pai', 'Nayak', 'Kini', 'Salian',
  'Choudhury', 'Barman',
];

const streets = [
  '12th Main, Indiranagar', '4th Cross, Koramangala', 'Anna Nagar West', 'Velachery Main Rd',
  'OMR, Sholinganallur', 'T Nagar, Pondy Bazaar', 'Adyar LB Road', 'Mylapore Luz Corner',
  'Whitefield ITPL', 'HSR Layout Sector 2', 'JP Nagar 3rd Phase', 'Malleswaram 15th Cross',
  'Rajajinagar 2nd Block', 'BTM 2nd Stage', 'Electronic City Phase 1', 'Marathahalli Bridge',
  'Hebbal Flyover', 'Yelahanka New Town', 'Bannerghatta National Park Rd', 'Sarjapur Road',
];

const diagnoses = [
  { d: 'Essential hypertension (I10)', n: 'Lifestyle counselling; home BP log for 2 weeks.' },
  { d: 'Type 2 diabetes mellitus — well controlled', n: 'HbA1c 6.4%; continue metformin; annual foot exam.' },
  { d: 'Acute viral upper respiratory infection', n: 'Supportive care; return if fever > 3 days or breathlessness.' },
  { d: 'Vitamin D deficiency', n: 'Cholecalciferol weekly x 8 weeks; recheck levels in 3 months.' },
  { d: 'Migraine without aura', n: 'Trigger diary; acute sumatriptan as needed; hydration.' },
  { d: 'Osteoarthritis — knee', n: 'Weight reduction plan; physiotherapy referral; topical NSAID.' },
  { d: 'Gastro-oesophageal reflux disease', n: 'PPI 4–8 weeks; avoid late meals; elevate head of bed.' },
  { d: 'Hypothyroidism — on replacement', n: 'TSH in range on levothyroxine 75 mcg; continue same dose.' },
  { d: 'Allergic rhinitis — seasonal', n: 'Intranasal steroid spray; saline rinses during pollen season.' },
  { d: 'Anaemia — iron deficiency', n: 'Oral iron with vitamin C; dietary iron sources reviewed.' },
];

async function main() {
  const { data: providers, error: pe } = await sb
    .from('healthcare_providers')
    .select('provider_id')
    .eq('verified', true)
    .limit(30);
  if (pe) throw pe;
  const provIds = (providers || []).map((p) => p.provider_id);
  if (provIds.length === 0) throw new Error('No verified providers in DB');

  const { data: services, error: se } = await sb
    .from('service_types')
    .select('service_id, service_name, base_price');
  if (se) throw se;
  const amb = services.find((s) => /ambulance/i.test(s.service_name));
  const nurse = services.find((s) => /nursing|nurse/i.test(s.service_name));
  const tele = services.find((s) => /tele/i.test(s.service_name));
  if (!amb || !nurse || !tele) throw new Error('Expected ambulance, nursing, teleconsult services');

  let created = 0;
  for (let i = 0; i < 50; i++) {
    const email = `seed.patient.${String(i + 1).padStart(3, '0')}@careconnect.demo`;
    const password = 'DemoPatient2026!';
    const name = `${first[i]} ${last[i]}`;
    const phone = `+91 9${String(100000000 + i * 137).slice(0, 9)}`;
    const address = `${streets[i % streets.length]}, Bengaluru 5600${String(10 + (i % 89)).padStart(2, '0')}`;

    const { data: auth, error: ae } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, name },
    });
    if (ae) {
      if (ae.message?.includes('already been registered')) {
        console.warn('Skip existing:', email);
        continue;
      }
      throw ae;
    }
    const uid = auth.user.id;

    const { error: ue } = await sb
      .from('profiles')
      .update({ name, phone, address })
      .eq('user_id', uid);
    if (ue) throw ue;

    const nRec = 2 + (i % 3);
    for (let r = 0; r < nRec; r++) {
      const pick = diagnoses[(i + r) % diagnoses.length];
      const daysAgo = 30 + i * 7 + r * 45;
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      const { error: re } = await sb.from('medical_records').insert({
        user_id: uid,
        diagnosis: pick.d,
        notes: `${pick.n} (seed record ${r + 1})`,
        record_date: d.toISOString().slice(0, 10),
      });
      if (re) throw re;
    }

    if (i % 2 === 0) {
      const pid = provIds[i % provIds.length];
      const svc = i % 3 === 0 ? amb : i % 3 === 1 ? nurse : tele;
      const loc = `${address} — visit pickup`;
      const { data: reqRow, error: rqe } = await sb
        .from('service_requests')
        .insert({
          user_id: uid,
          provider_id: pid,
          service_id: svc.service_id,
          location: loc,
          status: 'completed',
          location_lat: 12.97 + (i % 10) * 0.01,
          location_lng: 77.59 + (i % 10) * 0.01,
          eta_minutes: 0,
          dispatch_lat: 12.97,
          dispatch_lng: 77.59,
          request_time: new Date(Date.now() - (40 + i) * 86400000).toISOString(),
        })
        .select('request_id')
        .single();
      if (rqe) throw rqe;
      if (reqRow && i % 4 === 0) {
        await sb.from('payments').insert({
          request_id: reqRow.request_id,
          amount: Number(svc.base_price),
          method: 'upi',
          status: 'completed',
        });
        await sb.from('rating_feedback').insert({
          request_id: reqRow.request_id,
          rating: 4 + (i % 2),
          comments: 'Seed visit — professional and on time.',
        });
      }
    }

    created += 1;
    console.log('OK', email, name);
  }
  console.log('Done. Created', created, 'patients. Password for all:', 'DemoPatient2026!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
