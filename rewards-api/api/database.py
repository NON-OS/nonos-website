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
            reward_nox INTEGER DEFAULT 10000000000000000000000,
            approved_at TEXT DEFAULT CURRENT_TIMESTAMP,
            claimed INTEGER DEFAULT 0,
            UNIQUE(github_username, issue_number)
        )''')
        db.execute('''CREATE TABLE IF NOT EXISTS approved_prs (
            id INTEGER PRIMARY KEY,
            github_username TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            pr_title TEXT,
            reward_nox INTEGER DEFAULT 25000000000000000000000,
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
        # Add tx_hash columns if they don't exist
        try:
            db.execute("ALTER TABLE approved_issues ADD COLUMN tx_hash TEXT")
        except:
            pass
        try:
            db.execute("ALTER TABLE approved_issues ADD COLUMN claimed_at TEXT")
        except:
            pass
        try:
            db.execute("ALTER TABLE approved_prs ADD COLUMN tx_hash TEXT")
        except:
            pass
        try:
            db.execute("ALTER TABLE approved_prs ADD COLUMN claimed_at TEXT")
        except:
            pass
        try:
            db.execute("ALTER TABLE star_claims ADD COLUMN tx_hash TEXT")
        except:
            pass
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
    # Store in NOX units (not wei) to avoid SQLite integer overflow
    reward_nox = reward // 10**18 if reward >= 10**18 else reward
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO approved_issues (github_username, issue_number, issue_title, reward_nox) VALUES (?, ?, ?, ?)",
            (username.lower(), issue_number, title, reward_nox)
        )
        db.execute("DELETE FROM pending_issues WHERE github_username = ? AND issue_number = ?", (username.lower(), issue_number))
        db.commit()

def approve_pr(username: str, pr_number: int, title: str = "", reward: int = None):
    if reward is None:
        reward = DEFAULT_PR_REWARD
    # Store in NOX units (not wei) to avoid SQLite integer overflow
    reward_nox = reward // 10**18 if reward >= 10**18 else reward
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO approved_prs (github_username, pr_number, pr_title, reward_nox) VALUES (?, ?, ?, ?)",
            (username.lower(), pr_number, title, reward_nox)
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
            "SELECT issue_number, issue_title, reward_nox * 1000000000000000000 as reward, claimed FROM approved_issues WHERE github_username = ?",
            (username.lower(),)
        ).fetchall()
        return [dict(r) for r in rows]

def get_approved_prs(username: str):
    with get_db() as db:
        rows = db.execute(
            "SELECT pr_number, pr_title, reward_nox * 1000000000000000000 as reward, claimed FROM approved_prs WHERE github_username = ?",
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
            "UPDATE approved_issues SET claimed = 1, claimed_at = CURRENT_TIMESTAMP WHERE github_username = ? AND issue_number = ?",
            (username.lower(), issue_number)
        )
        db.commit()

def record_issue_tx(username: str, issue_number: int, tx_hash: str):
    with get_db() as db:
        db.execute(
            "UPDATE approved_issues SET tx_hash = ? WHERE github_username = ? AND issue_number = ?",
            (tx_hash, username.lower(), issue_number)
        )
        db.commit()

def mark_pr_claimed(username: str, pr_number: int):
    with get_db() as db:
        db.execute(
            "UPDATE approved_prs SET claimed = 1, claimed_at = CURRENT_TIMESTAMP WHERE github_username = ? AND pr_number = ?",
            (username.lower(), pr_number)
        )
        db.commit()

def record_pr_tx(username: str, pr_number: int, tx_hash: str):
    with get_db() as db:
        db.execute(
            "UPDATE approved_prs SET tx_hash = ? WHERE github_username = ? AND pr_number = ?",
            (tx_hash, username.lower(), pr_number)
        )
        db.commit()

def record_star_claim(username: str, wallet_address: str, tx_hash: str = None):
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO star_claims (github_username, wallet_address, tx_hash) VALUES (?, ?, ?)",
            (username.lower(), wallet_address, tx_hash)
        )
        db.commit()

def record_star_tx(username: str, tx_hash: str):
    with get_db() as db:
        db.execute(
            "UPDATE star_claims SET tx_hash = ? WHERE github_username = ?",
            (tx_hash, username.lower())
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
        star_claims = db.execute("SELECT COUNT(*) FROM star_claims").fetchone()[0]
        total_nox_issues = db.execute("SELECT COALESCE(SUM(reward_nox), 0) FROM approved_issues WHERE claimed = 1").fetchone()[0]
        total_nox_prs = db.execute("SELECT COALESCE(SUM(reward_nox), 0) FROM approved_prs WHERE claimed = 1").fetchone()[0]
        return {
            "pending_issues": pending_i, "pending_prs": pending_p,
            "approved_issues": approved_i, "approved_prs": approved_p,
            "claimed_issues": claimed_i, "claimed_prs": claimed_p,
            "star_claims": star_claims,
            "total_distributed_db": total_nox_issues + total_nox_prs
        }

def get_contributors():
    with get_db() as db:
        contributors = {}
        # Star claims
        stars = db.execute("SELECT github_username, claimed_at FROM star_claims").fetchall()
        for s in stars:
            u = s['github_username']
            if u not in contributors:
                contributors[u] = {'username': u, 'star': True, 'issues': 0, 'prs': 0, 'total_nox': 5000, 'last_activity': s['claimed_at']}
            else:
                contributors[u]['star'] = True
                contributors[u]['total_nox'] += 5000
        # Issues
        issues = db.execute("SELECT github_username, COUNT(*) as cnt, SUM(reward_nox) as total, MAX(approved_at) as last FROM approved_issues WHERE claimed = 1 GROUP BY github_username").fetchall()
        for i in issues:
            u = i['github_username']
            if u not in contributors:
                contributors[u] = {'username': u, 'star': False, 'issues': i['cnt'], 'prs': 0, 'total_nox': i['total'] or 0, 'last_activity': i['last']}
            else:
                contributors[u]['issues'] = i['cnt']
                contributors[u]['total_nox'] += i['total'] or 0
                if i['last'] > contributors[u]['last_activity']:
                    contributors[u]['last_activity'] = i['last']
        # PRs
        prs = db.execute("SELECT github_username, COUNT(*) as cnt, SUM(reward_nox) as total, MAX(approved_at) as last FROM approved_prs WHERE claimed = 1 GROUP BY github_username").fetchall()
        for p in prs:
            u = p['github_username']
            if u not in contributors:
                contributors[u] = {'username': u, 'star': False, 'issues': 0, 'prs': p['cnt'], 'total_nox': p['total'] or 0, 'last_activity': p['last']}
            else:
                contributors[u]['prs'] = p['cnt']
                contributors[u]['total_nox'] += p['total'] or 0
                if p['last'] > contributors[u]['last_activity']:
                    contributors[u]['last_activity'] = p['last']
        return sorted(contributors.values(), key=lambda x: x['total_nox'], reverse=True)

def get_claims_history(claim_type: str = None, status: str = None, limit: int = 100):
    claims = []
    with get_db() as db:
        # Stars
        if claim_type is None or claim_type == 'star':
            stars = db.execute("SELECT github_username, wallet_address, tx_hash, claimed_at FROM star_claims ORDER BY claimed_at DESC").fetchall()
            for s in stars:
                claims.append({'type': 'star', 'username': s['github_username'], 'number': 0, 'title': 'Star Reward', 'reward_nox': 5000, 'status': 'claimed', 'approved_at': s['claimed_at'], 'claimed_at': s['claimed_at'], 'tx_hash': s['tx_hash'], 'wallet': s['wallet_address']})
        # Issues
        if claim_type is None or claim_type == 'issue':
            issues = db.execute("SELECT github_username, issue_number, issue_title, reward_nox, claimed, approved_at, claimed_at, tx_hash FROM approved_issues ORDER BY approved_at DESC").fetchall()
            for i in issues:
                if status == 'claimed' and not i['claimed']:
                    continue
                if status == 'pending' and i['claimed']:
                    continue
                claims.append({'type': 'issue', 'username': i['github_username'], 'number': i['issue_number'], 'title': i['issue_title'] or '', 'reward_nox': i['reward_nox'], 'status': 'claimed' if i['claimed'] else 'approved', 'approved_at': i['approved_at'], 'claimed_at': i['claimed_at'], 'tx_hash': i['tx_hash'] if i['claimed'] else None})
        # PRs
        if claim_type is None or claim_type == 'pr':
            prs = db.execute("SELECT github_username, pr_number, pr_title, reward_nox, claimed, approved_at, claimed_at, tx_hash FROM approved_prs ORDER BY approved_at DESC").fetchall()
            for p in prs:
                if status == 'claimed' and not p['claimed']:
                    continue
                if status == 'pending' and p['claimed']:
                    continue
                claims.append({'type': 'pr', 'username': p['github_username'], 'number': p['pr_number'], 'title': p['pr_title'] or '', 'reward_nox': p['reward_nox'], 'status': 'claimed' if p['claimed'] else 'approved', 'approved_at': p['approved_at'], 'claimed_at': p['claimed_at'], 'tx_hash': p['tx_hash'] if p['claimed'] else None})
    claims.sort(key=lambda x: x['approved_at'] or '', reverse=True)
    return claims[:limit]

def get_activity(limit: int = 20):
    activity = []
    with get_db() as db:
        # Recent approvals
        issues = db.execute("SELECT 'issue_approved' as action, github_username, issue_number as number, issue_title as title, reward_nox, approved_at as timestamp FROM approved_issues ORDER BY approved_at DESC LIMIT ?", (limit,)).fetchall()
        prs = db.execute("SELECT 'pr_approved' as action, github_username, pr_number as number, pr_title as title, reward_nox, approved_at as timestamp FROM approved_prs ORDER BY approved_at DESC LIMIT ?", (limit,)).fetchall()
        stars = db.execute("SELECT 'star_claimed' as action, github_username, 0 as number, 'Star' as title, 5000 as reward_nox, claimed_at as timestamp FROM star_claims ORDER BY claimed_at DESC LIMIT ?", (limit,)).fetchall()
        for row in issues + prs + stars:
            activity.append({'action': row['action'], 'username': row['github_username'], 'number': row['number'], 'title': row['title'], 'reward_nox': row['reward_nox'], 'timestamp': row['timestamp']})
    activity.sort(key=lambda x: x['timestamp'] or '', reverse=True)
    return activity[:limit]

init_db()
