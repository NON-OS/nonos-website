from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from config import ADMIN_SECRET, ISSUE_REWARD, DEFAULT_PR_REWARD
from database import approve_issue, approve_pr, reject_issue, reject_pr, get_all_approved, get_all_pending, get_stats
from github import get_repo_issues, get_repo_prs

router = APIRouter(prefix="/admin")

class ApprovalRequest(BaseModel):
    username: str
    number: int
    title: str = ""
    reward: int | None = None

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
    reward = req.reward if req.reward else ISSUE_REWARD
    approve_issue(req.username, req.number, req.title, reward)
    return {"success": True, "message": f"Issue #{req.number} approved for @{req.username}", "reward": reward // 10**18}

@router.post("/approve/pr")
async def admin_approve_pr(req: ApprovalRequest, authorization: str = Header(None)):
    verify_admin(authorization)
    reward = req.reward if req.reward else DEFAULT_PR_REWARD
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
