"""
Lightweight usage tracking: who (which company/user) used which tool, for the
Super Admin's Usage page. Never raises — a logging failure must never break
the actual feature that triggered it.
"""
from app.core.auth import CurrentUser
from app.core.supabase_client import get_supabase


def log_usage(user: CurrentUser, event_type: str, details: dict | None = None) -> None:
    try:
        get_supabase().table("usage_events").insert({
            "profile_id": user.uid,
            "actor_email": user.email,
            "event_type": event_type,
            "details": details or {},
        }).execute()
    except Exception as e:
        print(f"[usage] failed to log {event_type}: {e}")
