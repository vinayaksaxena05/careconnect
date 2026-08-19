ADMIN_TABLES = {
    "profiles": {
        "pk": "user_id",
        "editable": ["name", "phone", "address", "role"],
    },
    "healthcare_providers": {
        "pk": "provider_id",
        "editable": [
            "name",
            "specialization",
            "license_number",
            "verified",
            "email",
            "phone",
            "address",
            "provider_user_id",
        ],
    },
    "service_types": {
        "pk": "service_id",
        "editable": ["service_name", "base_price", "duration_minutes"],
    },
    "service_requests": {
        "pk": "request_id",
        "editable": [
            "status",
            "location",
            "request_time",
            "provider_id",
            "service_id",
            "user_id",
            "location_lat",
            "location_lng",
            "eta_minutes",
            "dispatch_lat",
            "dispatch_lng",
            "updated_at",
            "visible_until",
            "route_points",
            "closed_at",
        ],
    },
    "emergency_requests": {
        "pk": "emergency_id",
        "editable": [
            "severity",
            "status",
            "location",
            "notes",
            "location_lat",
            "location_lng",
            "response_eta_minutes",
            "visible_until",
            "user_id",
        ],
    },
    "payments": {
        "pk": "payment_id",
        "editable": ["amount", "method", "status", "request_id"],
    },
    "prescriptions": {
        "pk": "prescription_id",
        "editable": ["medicines", "dosage", "request_id"],
    },
    "rating_feedback": {
        "pk": "feedback_id",
        "editable": ["rating", "comments", "request_id"],
    },
    "medical_records": {
        "pk": "record_id",
        "editable": ["diagnosis", "notes", "record_date", "user_id"],
    },
    "provider_availability": {
        "pk": "availability_id",
        "editable": ["provider_id", "date", "time_slot", "is_available"],
    },
}
