import httpx
from fastapi import HTTPException
from config import REPO_OWNER, REPO_NAME

async def get_github_user(token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.v3+json"
            },
            timeout=10.0
        )
        if response.status_code != 200:
            raise HTTPException(401, "Invalid GitHub token")
        return response.json()

async def check_star_status_with_token(token: str) -> bool:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/user/starred/{REPO_OWNER}/{REPO_NAME}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.v3+json"
            },
            timeout=10.0
        )
        return response.status_code == 204

async def check_star_status(username: str) -> bool:
    async with httpx.AsyncClient() as client:
        page = 1
        per_page = 100
        while page <= 10:
            response = await client.get(
                f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/stargazers",
                params={"per_page": per_page, "page": page},
                headers={"Accept": "application/vnd.github.v3+json"},
                timeout=15.0
            )
            if response.status_code != 200:
                return False
            stargazers = response.json()
            if not stargazers:
                return False
            for user in stargazers:
                if user.get("login", "").lower() == username.lower():
                    return True
            if len(stargazers) < per_page:
                return False
            page += 1
        return False

async def get_user_issues(username: str) -> list:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/issues",
            params={"creator": username, "state": "all"},
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0
        )
        if response.status_code != 200:
            return []
        issues = response.json()
        return [i for i in issues if "pull_request" not in i]

async def get_user_prs(username: str) -> list:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/pulls",
            params={"state": "closed"},
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0
        )
        if response.status_code != 200:
            return []
        prs = response.json()
        return [
            pr for pr in prs
            if pr["user"]["login"].lower() == username.lower()
            and pr.get("merged_at")
        ]

async def get_repo_stats() -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}",
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0
        )
        if response.status_code != 200:
            return {"stars": 0, "issues": 0}
        data = response.json()
        return {
            "stars": data.get("stargazers_count", 0),
            "issues": data.get("open_issues_count", 0)
        }

async def get_repo_issues() -> list:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/issues",
            params={"state": "all", "per_page": 100},
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0
        )
        if response.status_code != 200:
            return []
        issues = response.json()
        return [{"number": i["number"], "title": i["title"], "user": i["user"]["login"], "state": i["state"]} for i in issues if "pull_request" not in i]

async def get_repo_prs() -> list:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/pulls",
            params={"state": "all", "per_page": 100},
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=10.0
        )
        if response.status_code != 200:
            return []
        prs = response.json()
        return [{"number": p["number"], "title": p["title"], "user": p["user"]["login"], "merged": bool(p.get("merged_at"))} for p in prs]
