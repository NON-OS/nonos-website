from pydantic import BaseModel, field_validator
import re

class ClaimRequest(BaseModel):
    wallet_address: str
    github_token: str

    @field_validator('wallet_address')
    @classmethod
    def validate_wallet(cls, v):
        if not re.match(r'^0x[a-fA-F0-9]{40}$', v):
            raise ValueError('Invalid wallet address')
        return v

    @field_validator('github_token')
    @classmethod
    def validate_token(cls, v):
        if len(v) < 10 or len(v) > 500:
            raise ValueError('Invalid token length')
        return v

class ClaimResponse(BaseModel):
    success: bool
    amount: str
    nonce: int
    github_hash: str
    signature: str
    message: str
    issue_id: int | None = None
    pr_id: int | None = None

class VerifyResponse(BaseModel):
    verified: bool
    username: str
    has_starred: bool
    account_age_days: int
    eligible: bool
    issues_count: int
    prs_merged_count: int
    star_reward: int
    message: str

class StatsResponse(BaseModel):
    repo_stars: int
    open_issues: int
    contributors: int
