from fastapi import APIRouter, HTTPException
from web3 import Web3
from config import STAR_REWARD, ISSUE_REWARD, DEFAULT_PR_REWARD
from models import ClaimRequest, ClaimResponse, VerifyResponse
from github import get_github_user, check_star_status, check_star_status_with_token, get_user_issues, get_user_prs
from signing import github_hash, generate_nonce, sign_star_claim, sign_issue_claim, sign_pr_claim
from rate_limiter import rate_limiter
from database import get_approved_issues, get_approved_prs, mark_issue_claimed, mark_pr_claimed, get_user_pending_issues, get_user_pending_prs

router = APIRouter()

@router.post("/verify", response_model=VerifyResponse)
async def verify_contributions(request: ClaimRequest):
    user = await get_github_user(request.github_token)
    username = user["login"]
    has_starred = await check_star_status_with_token(request.github_token)
    if not has_starred:
        has_starred = await check_star_status(username)
    issues = await get_user_issues(username)
    merged_prs = await get_user_prs(username)
    approved_issues = get_approved_issues(username)
    approved_prs = get_approved_prs(username)
    eligible = has_starred
    message = "Eligible for star reward - claim now!" if eligible else "Star the repository to earn 5,000 NOX"
    return VerifyResponse(
        verified=True,
        username=username,
        has_starred=has_starred,
        account_age_days=0,
        eligible=eligible,
        issues_count=len(issues),
        prs_merged_count=len(merged_prs),
        star_reward=STAR_REWARD // 10**18 if eligible else 0,
        message=message
    )

@router.get("/dashboard")
async def get_user_dashboard(github_token: str):
    user = await get_github_user(github_token)
    username = user["login"]
    has_starred = await check_star_status_with_token(github_token)
    if not has_starred:
        has_starred = await check_star_status(username)
    issues = await get_user_issues(username)
    merged_prs = await get_user_prs(username)
    approved_issues = get_approved_issues(username)
    approved_prs = get_approved_prs(username)
    pending_issues = get_user_pending_issues(username)
    pending_prs = get_user_pending_prs(username)
    return {
        "username": username,
        "github_hash": github_hash(username),
        "star": {"eligible": has_starred, "reward": STAR_REWARD // 10**18},
        "issues": {"submitted": len(issues), "approved": len(approved_issues), "pending": len(pending_issues), "approved_list": approved_issues},
        "prs": {"submitted": len(merged_prs), "approved": len(approved_prs), "pending": len(pending_prs), "approved_list": approved_prs},
        "rewards": {"star": STAR_REWARD // 10**18, "issue": ISSUE_REWARD // 10**18, "pr_default": DEFAULT_PR_REWARD // 10**18}
    }

@router.post("/claim/star", response_model=ClaimResponse)
async def claim_star_reward(request: ClaimRequest):
    try:
        wallet = Web3.to_checksum_address(request.wallet_address)
    except:
        raise HTTPException(400, "Invalid wallet address")
    user = await get_github_user(request.github_token)
    username = user["login"]
    has_starred = await check_star_status_with_token(request.github_token)
    if not has_starred:
        has_starred = await check_star_status(username)
    if not has_starred:
        raise HTTPException(400, "Star the repository to claim your 5,000 NOX reward")
    gh_hash = github_hash(username)
    can_claim, message = rate_limiter.can_claim(gh_hash)
    if not can_claim:
        raise HTTPException(429, message)
    nonce = generate_nonce()
    try:
        signature = sign_star_claim(wallet, STAR_REWARD, nonce, gh_hash)
    except Exception as e:
        raise HTTPException(500, f"Failed to sign claim: {str(e)}")
    rate_limiter.record_claim(gh_hash)
    return ClaimResponse(success=True, amount=str(STAR_REWARD), nonce=nonce, github_hash=gh_hash, signature=signature, message="Star claim ready. Submit to contract.")

@router.post("/claim/issue/{issue_id}", response_model=ClaimResponse)
async def claim_issue_reward(issue_id: int, request: ClaimRequest):
    try:
        wallet = Web3.to_checksum_address(request.wallet_address)
    except:
        raise HTTPException(400, "Invalid wallet address")
    user = await get_github_user(request.github_token)
    username = user["login"]
    approved = get_approved_issues(username)
    issue = next((i for i in approved if i["issue_number"] == issue_id and not i["claimed"]), None)
    if not issue:
        raise HTTPException(400, "Issue not approved or already claimed")
    gh_hash = github_hash(username)
    nonce = generate_nonce()
    amount = issue.get("reward", ISSUE_REWARD)
    try:
        signature = sign_issue_claim(wallet, amount, nonce, gh_hash, issue_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to sign: {str(e)}")
    mark_issue_claimed(username, issue_id)
    return ClaimResponse(success=True, amount=str(amount), nonce=nonce, github_hash=gh_hash, signature=signature, message=f"Issue #{issue_id} claim ready.", issue_id=issue_id)

@router.post("/claim/pr/{pr_id}", response_model=ClaimResponse)
async def claim_pr_reward(pr_id: int, request: ClaimRequest):
    try:
        wallet = Web3.to_checksum_address(request.wallet_address)
    except:
        raise HTTPException(400, "Invalid wallet address")
    user = await get_github_user(request.github_token)
    username = user["login"]
    approved = get_approved_prs(username)
    pr = next((p for p in approved if p["pr_number"] == pr_id and not p["claimed"]), None)
    if not pr:
        raise HTTPException(400, "PR not approved or already claimed")
    gh_hash = github_hash(username)
    nonce = generate_nonce()
    amount = pr.get("reward", DEFAULT_PR_REWARD)
    try:
        signature = sign_pr_claim(wallet, amount, nonce, gh_hash, pr_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to sign: {str(e)}")
    mark_pr_claimed(username, pr_id)
    return ClaimResponse(success=True, amount=str(amount), nonce=nonce, github_hash=gh_hash, signature=signature, message=f"PR #{pr_id} claim ready.", pr_id=pr_id)
