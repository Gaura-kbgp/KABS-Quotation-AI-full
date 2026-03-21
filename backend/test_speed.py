import time, httpx, asyncio

async def test():
    start = time.time()
    async with httpx.AsyncClient() as client:
        r = await client.post(
            'http://localhost:8000/api/generate-bom?project_id=de7ef0d3-be13-4eb9-8d7d-4ce616778b70&manufacturer_id=3be07931-596a-4fa3-8d39-8d04c36cf4bb',
            timeout=120.0
        )
    end = time.time()
    print(f"Status: {r.status_code}")
    print(f"Time: {end - start:.2f}s")
    print(f"Result: {r.json()}")

if __name__ == "__main__":
    asyncio.run(test())
