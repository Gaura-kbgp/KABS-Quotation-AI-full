import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

def get_nvidia_client():
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key or api_key == "your_nvidia_api_key_here":
        # Fallback to Gemini if NVIDIA key is not set yet, to avoid breaking everything immediately
        # But the user asked to remove Gemini, so we should prioritize NVIDIA.
        pass
    
    client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=api_key
    )
    return client

def nvidia_generate(prompt: str, model: str = "meta/llama-3.1-70b-instruct", is_vision: bool = False, image_data: bytes = None, system_prompt: str = None, max_tokens: int = 4096):
    client = get_nvidia_client()
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
        
    if is_vision and image_data:
        # Placeholder for vision implementation if needed
        # NVIDIA vision models usually take base64 images
        import base64
        base64_image = base64.b64encode(image_data).decode('utf-8')
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:application/pdf;base64,{base64_image}" if prompt.lower().contains("pdf") else f"data:image/jpeg;base64,{base64_image}"
                    }
                }
            ]
        })
    else:
        messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        top_p=0.7,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content
