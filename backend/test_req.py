import httpx
import asyncio

async def run():
    res = await httpx.AsyncClient().post(
        'http://localhost:9007/api/generate-bom', 
        json={'projectId': 'de7ef0d3-be13-4eb9-8d7d-4ce616778b70', 'manufacturerId': '3be07931-596a-4fa3-8d39-8d04c36cf4bb'},
        timeout=30.0
    )
    print(res.status_code)
    try:
        print(res.json())
    except:
        print(res.text)

asyncio.run(run())
