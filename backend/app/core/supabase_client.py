import os
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
import httpx

def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    # Check for service role key or a generic key
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise Exception("Supabase credentials missing in backend environment (Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY)")
    
    # Force no proxy in the underlying httpx client
    # Some older postgrest versions passed 'proxy' instead of 'proxies' which breaks in newer httpx
    # Or some environments inject 'proxy' into kwargs.
    try:
        # Try to use a clean httpx client
        http_client = httpx.Client(trust_env=False)
        options = ClientOptions(http_client=http_client)
        return create_client(url, key, options=options)
    except Exception as e:
        print(f"DEBUG: Supabase custom client creation failed ({e}), falling back to standard...")
        return create_client(url, key)

