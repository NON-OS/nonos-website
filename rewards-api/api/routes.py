from datetime import datetime
from fastapi import APIRouter, Query
from models import StatsResponse
from github import get_repo_stats
from contract import get_contract_stats
from routes_auth import router as auth_router
from routes_claims import router as claims_router
from database import get_contributors

router = APIRouter()
router.include_router(auth_router)
router.include_router(claims_router)

@router.get("/stats", response_model=StatsResponse)
async def get_stats():
    repo_stats = await get_repo_stats()
    return StatsResponse(
        repo_stars=repo_stats["stars"],
        open_issues=repo_stats["issues"],
        contributors=0
    )

@router.get("/contract/stats")
async def contract_stats():
    return await get_contract_stats()

@router.get("/leaderboard")
async def get_leaderboard(limit: int = Query(10, le=50)):
    contributors = get_contributors()
    return contributors[:limit]

@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    }
