from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from config import ADMIN_SECRET, ISSUE_REWARD, DEFAULT_PR_REWARD, STAR_REWARD, CONTRACT_ADDRESS, CONTRACT_ADDRESS_V1
from database import approve_issue, approve_pr, reject_issue, reject_pr, get_all_approved, get_all_pending, get_stats, get_contributors, get_claims_history, get_activity
from github import get_repo_issues, get_repo_prs
import csv
import io

router = APIRouter(prefix="/admin")

class ApprovalRequest(BaseModel):
    username: str
    number: int
    title: str = ""
    reward: float | None = None  # Accept float for large wei values

class RejectRequest(BaseModel):
    username: str
    number: int

def verify_admin(authorization: str = Header(None)):
    if not authorization or authorization != f"Bearer {ADMIN_SECRET}":
        raise HTTPException(401, "Unauthorized")

@router.get("/stats")
async def get_admin_stats(authorization: str = Header(None)):
    verify_admin(authorization)
    return get_stats()

@router.get("/pending")
async def get_pending(authorization: str = Header(None)):
    verify_admin(authorization)
    return get_all_pending()

@router.get("/approved")
async def get_approved(authorization: str = Header(None)):
    verify_admin(authorization)
    return get_all_approved()

@router.post("/approve/issue")
async def admin_approve_issue(req: ApprovalRequest, authorization: str = Header(None)):
    verify_admin(authorization)
    reward = int(req.reward) if req.reward else ISSUE_REWARD
    approve_issue(req.username, req.number, req.title, reward)
    return {"success": True, "message": f"Issue #{req.number} approved for @{req.username}", "reward": reward // 10**18}

@router.post("/approve/pr")
async def admin_approve_pr(req: ApprovalRequest, authorization: str = Header(None)):
    verify_admin(authorization)
    reward = int(req.reward) if req.reward else DEFAULT_PR_REWARD
    approve_pr(req.username, req.number, req.title, reward)
    return {"success": True, "message": f"PR #{req.number} approved for @{req.username}", "reward": reward // 10**18}

@router.post("/reject/issue")
async def admin_reject_issue(req: RejectRequest, authorization: str = Header(None)):
    verify_admin(authorization)
    reject_issue(req.username, req.number)
    return {"success": True, "message": f"Issue #{req.number} rejected for @{req.username}"}

@router.post("/reject/pr")
async def admin_reject_pr(req: RejectRequest, authorization: str = Header(None)):
    verify_admin(authorization)
    reject_pr(req.username, req.number)
    return {"success": True, "message": f"PR #{req.number} rejected for @{req.username}"}

@router.get("/issues")
async def list_repo_issues(authorization: str = Header(None)):
    verify_admin(authorization)
    return await get_repo_issues()

@router.get("/prs")
async def list_repo_prs(authorization: str = Header(None)):
    verify_admin(authorization)
    return await get_repo_prs()

@router.get("/contributors")
async def list_contributors(authorization: str = Header(None)):
    verify_admin(authorization)
    return get_contributors()

@router.get("/claims")
async def list_claims(
    authorization: str = Header(None),
    type: str = Query(None, description="Filter by type: star, issue, pr"),
    status: str = Query(None, description="Filter by status: claimed, pending"),
    limit: int = Query(100, description="Max results")
):
    verify_admin(authorization)
    return get_claims_history(type, status, limit)

@router.get("/activity")
async def get_recent_activity(authorization: str = Header(None), limit: int = Query(20)):
    verify_admin(authorization)
    return get_activity(limit)

@router.get("/config")
async def get_config(authorization: str = Header(None)):
    verify_admin(authorization)
    return {
        "contract_v2": CONTRACT_ADDRESS,
        "contract_v1": CONTRACT_ADDRESS_V1,
        "rewards": {
            "star": STAR_REWARD // 10**18,
            "issue": ISSUE_REWARD // 10**18,
            "pr": DEFAULT_PR_REWARD // 10**18
        }
    }

@router.get("/export/csv")
async def export_csv(authorization: str = Header(None)):
    verify_admin(authorization)
    claims = get_claims_history(limit=10000)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['type', 'username', 'number', 'title', 'reward_nox', 'status', 'approved_at', 'claimed_at'])
    writer.writeheader()
    writer.writerows(claims)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=nox_claims_export.csv"}
    )
