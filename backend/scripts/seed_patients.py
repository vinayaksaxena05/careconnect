"""
Creates ~50 demo patient accounts with profiles, medical history, and sample visits.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in backend/.env

Run: python -m scripts.seed_patients
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

import os

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
if not url or not key:
    print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env", file=sys.stderr)
    sys.exit(1)

sb = create_client(url, key)

FIRST = [
    "Ananya", "Rahul", "Kavitha", "Suresh", "Meena", "Vikram", "Deepa", "Kiran",
    "Lakshmi", "Arvind", "Sunita", "Naveen", "Padma", "Girish", "Revathi", "Manoj",
    "Shanti", "Prakash", "Uma", "Dinesh", "Radha", "Srinivas", "Kalpana", "Harish",
    "Vimala", "Ashwin", "Jyoti", "Ramesh", "Nithya", "Karthik", "Sowmya", "Bharath",
    "Indira", "Ganesh", "Malathi", "Senthil", "Archana", "Varun", "Yamini", "Pradeep",
    "Keerthi", "Murali", "Swathi", "Raghav", "Tanvi", "Siddharth", "Priyanka", "Aditya",
    "Neha", "Rohit",
]
LAST = [
    "Iyer", "Menon", "Reddy", "Nair", "Krishnan", "Subramanian", "Pillai", "Rao",
    "Desai", "Kapoor", "Verma", "Joshi", "Patel", "Sharma", "Singh", "Kulkarni",
    "Bose", "Ghosh", "Banerjee", "Chatterjee", "Mukherjee", "Das", "Sen", "Roy",
    "Thomas", "George", "Mathew", "Joseph", "Fernandes", "D'Souza", "Pereira", "Rodrigues",
    "Khan", "Ahmed", "Hussain", "Malik", "Sheikh", "Ansari", "Bhat", "Kaul",
    "Murthy", "Shetty", "Hegde", "Kamath", "Pai", "Nayak", "Kini", "Salian",
    "Choudhury", "Barman",
]
STREETS = [
    "12th Main, Indiranagar", "4th Cross, Koramangala", "Anna Nagar West", "Velachery Main Rd",
    "OMR, Sholinganallur", "T Nagar, Pondy Bazaar", "Adyar LB Road", "Mylapore Luz Corner",
    "Whitefield ITPL", "HSR Layout Sector 2", "JP Nagar 3rd Phase", "Malleswaram 15th Cross",
    "Rajajinagar 2nd Block", "BTM 2nd Stage", "Electronic City Phase 1", "Marathahalli Bridge",
    "Hebbal Flyover", "Yelahanka New Town", "Bannerghatta National Park Rd", "Sarjapur Road",
]
DIAGNOSES = [
    {"d": "Essential hypertension (I10)", "n": "Lifestyle counselling; home BP log for 2 weeks."},
    {"d": "Type 2 diabetes mellitus — well controlled", "n": "HbA1c 6.4%; continue metformin; annual foot exam."},
    {"d": "Acute viral upper respiratory infection", "n": "Supportive care; return if fever > 3 days or breathlessness."},
    {"d": "Vitamin D deficiency", "n": "Cholecalciferol weekly x 8 weeks; recheck levels in 3 months."},
    {"d": "Migraine without aura", "n": "Trigger diary; acute sumatriptan as needed; hydration."},
    {"d": "Osteoarthritis — knee", "n": "Weight reduction plan; physiotherapy referral; topical NSAID."},
    {"d": "Gastro-oesophageal reflux disease", "n": "PPI 4–8 weeks; avoid late meals; elevate head of bed."},
    {"d": "Hypothyroidism — on replacement", "n": "TSH in range on levothyroxine 75 mcg; continue same dose."},
    {"d": "Allergic rhinitis — seasonal", "n": "Intranasal steroid spray; saline rinses during pollen season."},
    {"d": "Anaemia — iron deficiency", "n": "Oral iron with vitamin C; dietary iron sources reviewed."},
]


def main() -> None:
    providers = (
        sb.table("healthcare_providers")
        .select("provider_id")
        .eq("verified", True)
        .limit(30)
        .execute()
    )
    prov_ids = [p["provider_id"] for p in (providers.data or [])]
    if not prov_ids:
        raise RuntimeError("No verified providers in DB")

    services = sb.table("service_types").select("service_id, service_name, base_price").execute()
    svc_rows = services.data or []
    amb = next((s for s in svc_rows if re.search(r"ambulance", s["service_name"], re.I)), None)
    nurse = next((s for s in svc_rows if re.search(r"nursing|nurse", s["service_name"], re.I)), None)
    tele = next((s for s in svc_rows if re.search(r"tele", s["service_name"], re.I)), None)
    if not amb or not nurse or not tele:
        raise RuntimeError("Expected ambulance, nursing, teleconsult services")

    created = 0
    for i in range(50):
        email = f"seed.patient.{str(i + 1).zfill(3)}@careconnect.demo"
        password = "DemoPatient2026!"
        name = f"{FIRST[i]} {LAST[i]}"
        phone = f"+91 9{str(100000000 + i * 137)[:9]}"
        address = (
            f"{STREETS[i % len(STREETS)]}, Bengaluru 5600{str(10 + (i % 89)).zfill(2)}"
        )

        try:
            auth = sb.auth.admin.create_user(
                {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"full_name": name, "name": name},
                }
            )
        except Exception as ae:
            msg = str(ae)
            if "already been registered" in msg:
                print("Skip existing:", email)
                continue
            raise

        uid = auth.user.id
        sb.table("profiles").update(
            {"name": name, "phone": phone, "address": address}
        ).eq("user_id", uid).execute()

        n_rec = 2 + (i % 3)
        for r in range(n_rec):
            pick = DIAGNOSES[(i + r) % len(DIAGNOSES)]
            days_ago = 30 + i * 7 + r * 45
            d = datetime.now(timezone.utc) - timedelta(days=days_ago)
            sb.table("medical_records").insert(
                {
                    "user_id": uid,
                    "diagnosis": pick["d"],
                    "notes": f"{pick['n']} (seed record {r + 1})",
                    "record_date": d.date().isoformat(),
                }
            ).execute()

        if i % 2 == 0:
            pid = prov_ids[i % len(prov_ids)]
            svc = amb if i % 3 == 0 else nurse if i % 3 == 1 else tele
            loc = f"{address} — visit pickup"
            req = (
                sb.table("service_requests")
                .insert(
                    {
                        "user_id": uid,
                        "provider_id": pid,
                        "service_id": svc["service_id"],
                        "location": loc,
                        "status": "completed",
                        "location_lat": 12.97 + (i % 10) * 0.01,
                        "location_lng": 77.59 + (i % 10) * 0.01,
                        "eta_minutes": 0,
                        "dispatch_lat": 12.97,
                        "dispatch_lng": 77.59,
                        "request_time": (
                            datetime.now(timezone.utc) - timedelta(days=40 + i)
                        ).isoformat(),
                    }
                )
                .select("request_id")
                .single()
                .execute()
            )
            if req.data and i % 4 == 0:
                sb.table("payments").insert(
                    {
                        "request_id": req.data["request_id"],
                        "amount": float(svc["base_price"]),
                        "method": "upi",
                        "status": "completed",
                    }
                ).execute()
                sb.table("rating_feedback").insert(
                    {
                        "request_id": req.data["request_id"],
                        "rating": 4 + (i % 2),
                        "comments": "Seed visit — professional and on time.",
                    }
                ).execute()

        created += 1
        print("OK", email, name)

    print("Done. Created", created, "patients. Password for all:", "DemoPatient2026!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
