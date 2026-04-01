import time
import threading
from collections import defaultdict

class RateLimiter:
    def __init__(self, max_per_hour: int = 50, max_per_day: int = 200):
        self.max_per_hour = max_per_hour
        self.max_per_day = max_per_day
        self.hourly_claims = []
        self.daily_claims = []
        self.github_claims = {}
        self.ip_requests = defaultdict(list)
        self.lock = threading.Lock()

    def _cleanup(self):
        now = time.time()
        hour_ago = now - 3600
        day_ago = now - 86400
        minute_ago = now - 60
        self.hourly_claims = [t for t in self.hourly_claims if t > hour_ago]
        self.daily_claims = [t for t in self.daily_claims if t > day_ago]
        for ip in list(self.ip_requests.keys()):
            self.ip_requests[ip] = [t for t in self.ip_requests[ip] if t > minute_ago]
            if not self.ip_requests[ip]:
                del self.ip_requests[ip]

    def check_ip_rate(self, ip: str, max_per_minute: int = 30) -> tuple[bool, str]:
        with self.lock:
            self._cleanup()
            now = time.time()
            if len(self.ip_requests[ip]) >= max_per_minute:
                return False, "Too many requests"
            self.ip_requests[ip].append(now)
            return True, "OK"

    def can_claim(self, github_hash: str) -> tuple[bool, str]:
        with self.lock:
            self._cleanup()
            now = time.time()
            if github_hash in self.github_claims:
                return False, "GitHub account already claimed"
            if len(self.hourly_claims) >= self.max_per_hour:
                mins_left = int((self.hourly_claims[0] + 3600 - now) / 60) + 1
                return False, f"Hourly limit reached. Try again in {mins_left} minutes"
            if len(self.daily_claims) >= self.max_per_day:
                hours_left = int((self.daily_claims[0] + 86400 - now) / 3600) + 1
                return False, f"Daily limit reached. Try again in {hours_left} hours"
            return True, "OK"

    def record_claim(self, github_hash: str):
        with self.lock:
            now = time.time()
            self.hourly_claims.append(now)
            self.daily_claims.append(now)
            self.github_claims[github_hash] = now

    def get_stats(self) -> dict:
        with self.lock:
            self._cleanup()
            return {
                "claims_this_hour": len(self.hourly_claims),
                "claims_today": len(self.daily_claims),
                "max_per_hour": self.max_per_hour,
                "max_per_day": self.max_per_day,
                "unique_claimants": len(self.github_claims)
            }

rate_limiter = RateLimiter(max_per_hour=50, max_per_day=200)
