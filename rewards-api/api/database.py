import sqlite3
from contextlib import contextmanager
from pathlib import Path
from config import ISSUE_REWARD, DEFAULT_PR_REWARD

DB_PATH = Path(__file__).parent / "rewards.db"

def init_db():
    with get_db() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS approved_issues (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL,
            issue_number INTEGER NOT NULL,
            issue_title TEXT,
            reward INTEGER DEFAULT 10000000000000000000000,
            approved_at TEXT DEFAULT CURRENT_TIMESTAMP,
            claimed INTEGER DEFAULT 0,
            UNIQUE(github_username, issue_number)
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS approved_prs (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            pr_title TEXT,
            reward INTEGER DEFAULT 25000000000000000000000,
            approved_at TEXT DEFAULT CURRENT_TIMESTAMP,
            claimed INTEGER DEFAULT 0,
            UNIQUE(github_username, pr_number)
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS pending_issues (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL,
            issue_number INTEGER NOT NULL,
            issue_title TEXT,
            submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(github_username, issue_number)
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS pending_prs (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            pr_title TEXT,
            submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(github_username, pr_number)
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS star_claims (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL UNIQUE,
            wallet_address TEXT NOT NULL,
            claimed_at TEXT DEFAULT CURRENT_TIMESTAMP
        )''')
        db.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def approve_issue(username: str, issue_number: int, title: str = "", reward: int = None):
    if reward is None:
        reward = ISSUE_REWARD
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO approved_issues (github_username, issue_number, issue_title, reward) VALUES (?, ?, ?, ?)",
            (username.lower(), issue_number, title, reward)
        )
        db.execute("DELETE FROM pending_issues WHERE github_username = ? AND issue_number = ?", (username.lower(), issue_number))
        db.commit()

def approve_pr(username: str, pr_number: int, title: str = "", reward: int = None):
    if reward is None:
        reward = DEFAULT_PR_REWARD
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO approved_prs (github_username, pr_number, pr_title, reward) VALUES (?, ?, ?, ?)",
            (username.lower(), pr_number, title, reward)
        )
        db.execute("DELETE FROM pending_prs WHERE github_username = ? AND pr_number = ?", (username.lower(), pr_number))
        db.commit()

def submit_issue_for_approval(username: str, issue_number: int, title: str = ""):
    with get_db() as db:
        db.execute(
            "INSERT OR IGNORE INTO pending_issues (github_username, issue_number, issue_title) VALUES (?, ?, ?)",
            (username.lower(), issue_number, title)
        )
        db.commit()

def submit_pr_for_approval(username: str, pr_number: int, title: str = ""):
    with get_db() as db:
        db.execute(
            "INSERT OR IGNORE INTO pending_prs (github_username, pr_number, pr_title) VALUES (?, ?, ?)",
            (username.lower(), pr_number, title)
        )
        db.commit()

def get_approved_issues(username: str):
    with get_db() as db:
        rows = db.execute(
            "SELECT issue_number, issue_title, reward, claimed FROM approved_issues WHERE github_username = ?",
            (username.lower(),)
        ).fetchall()
        return [dict(r) for r in rows]

def get_approved_prs(username: str):
    with get_db() as db:
        rows = db.execute(
            "SELECT pr_number, pr_title, reward, claimed FROM approved_prs WHERE github_username = ?",
            (username.lower(),)
        ).fetchall()
        return [dict(r) for r in rows]

def get_user_pending_issues(username: str):
    with get_db() as db:
        rows = db.execute(
            "SELECT issue_number, issue_title, submitted_at FROM pending_issues WHERE github_username = ?",
            (username.lower(),)
        ).fetchall()
        return [dict(r) for r in rows]

def get_user_pending_prs(username: str):
    with get_db() as db:
        rows = db.execute(
            "SELECT pr_number, pr_title, submitted_at FROM pending_prs WHERE github_username = ?",
            (username.lower(),)
        ).fetchall()
        return [dict(r) for r in rows]

def mark_issue_claimed(username: str, issue_number: int):
    with get_db() as db:
        db.execute(
            "UPDATE approved_issues SET claimed = 1 WHERE github_username = ? AND issue_number = ?",
            (username.lower(), issue_number)
        )
        db.commit()

def mark_pr_claimed(username: str, pr_number: int):
    with get_db() as db:
        db.execute(
            "UPDATE approved_prs SET claimed = 1 WHERE github_username = ? AND pr_number = ?",
            (username.lower(), pr_number)
        )
        db.commit()

def reject_issue(username: str, issue_number: int):
    with get_db() as db:
        db.execute("DELETE FROM pending_issues WHERE github_username = ? AND issue_number = ?", (username.lower(), issue_number))
        db.commit()

def reject_pr(username: str, pr_number: int):
    with get_db() as db:
        db.execute("DELETE FROM pending_prs WHERE github_username = ? AND pr_number = ?", (username.lower(), pr_number))
        db.commit()

def get_all_pending():
    with get_db() as db:
        issues = db.execute("SELECT * FROM pending_issues ORDER BY submitted_at DESC").fetchall()
        prs = db.execute("SELECT * FROM pending_prs ORDER BY submitted_at DESC").fetchall()
        return {"issues": [dict(r) for r in issues], "prs": [dict(r) for r in prs]}

def get_all_approved():
    with get_db() as db:
        issues = db.execute("SELECT * FROM approved_issues ORDER BY approved_at DESC").fetchall()
        prs = db.execute("SELECT * FROM approved_prs ORDER BY approved_at DESC").fetchall()
        return {"issues": [dict(r) for r in issues], "prs": [dict(r) for r in prs]}

def get_stats():
    with get_db() as db:
        pending_i = db.execute("SELECT COUNT(*) FROM pending_issues").fetchone()[0]
        pending_p = db.execute("SELECT COUNT(*) FROM pending_prs").fetchone()[0]
        approved_i = db.execute("SELECT COUNT(*) FROM approved_issues").fetchone()[0]
        approved_p = db.execute("SELECT COUNT(*) FROM approved_prs").fetchone()[0]
        claimed_i = db.execute("SELECT COUNT(*) FROM approved_issues WHERE claimed = 1").fetchone()[0]
        claimed_p = db.execute("SELECT COUNT(*) FROM approved_prs WHERE claimed = 1").fetchone()[0]
        return {
            "pending_issues": pending_i, "pending_prs": pending_p,
            "approved_issues": approved_i, "approved_prs": approved_p,
            "claimed_issues": claimed_i, "claimed_prs": claimed_p
        }

init_db()
