import os
from supabase import create_client, Client

def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    # Check for service role key or a generic key
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise Exception("Supabase credentials missing in backend environment (Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY)")
    return create_client(url, key)

