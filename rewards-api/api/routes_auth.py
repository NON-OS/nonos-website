import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse, JSONResponse
from config import GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, FRONTEND_URL

router = APIRouter()

@router.get("/auth/github")
async def github_auth():
    if not GITHUB_CLIENT_ID:
        raise HTTPException(500, "GitHub OAuth not configured")
    return RedirectResponse(
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&scope=read:user"
        f"&redirect_uri={FRONTEND_URL}/contribute/?oauth=callback"
    )

@router.get("/auth/github/callback")
async def github_callback(code: str = Query(...)):
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(500, "GitHub OAuth not configured")
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code
            },
            headers={"Accept": "application/json"},
            timeout=10.0
        )
        if response.status_code != 200:
            raise HTTPException(400, "Failed to exchange code")
        data = response.json()
        if "error" in data:
            raise HTTPException(400, data.get("error_description", "OAuth failed"))
        return JSONResponse({
            "access_token": data["access_token"],
            "token_type": "bearer"
        })
