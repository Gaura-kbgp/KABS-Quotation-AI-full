"""
Single entry point for text LLM calls (OpenAI).

Configure in the server's .env:
  OPENAI_API_KEY   - required
  OPENAI_MODEL     - optional, default gpt-4o-mini (cheap, reliable JSON)
  OPENAI_MODEL_BALANCED / OPENAI_MODEL_PRO - optional tier overrides
"""
import base64
import os

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
TIER_MODELS = {
    "flash": DEFAULT_MODEL,
    "balanced": os.getenv("OPENAI_MODEL_BALANCED", "gpt-4o"),
    "pro-high": os.getenv("OPENAI_MODEL_PRO", "gpt-4o"),
}


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set on the server.")
    return OpenAI(api_key=api_key)


def llm_generate(
    prompt: str,
    tier: str = "flash",
    system_prompt: str | None = None,
    max_tokens: int = 4096,
    image_data: bytes | None = None,
    image_mime: str = "image/jpeg",
) -> str:
    client = get_openai_client()
    model = TIER_MODELS.get(tier, DEFAULT_MODEL)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    if image_data:
        b64 = base64.b64encode(image_data).decode("utf-8")
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
            ],
        })
    else:
        messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content
