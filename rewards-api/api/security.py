import hashlib
import hmac
import re
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from config import API_SECRET

BLOCKED_PATTERNS = [
    re.compile(r'<script', re.I),
    re.compile(r'javascript:', re.I),
    re.compile(r'on\w+\s*=', re.I),
    re.compile(r'eval\s*\(', re.I),
    re.compile(r'document\.', re.I),
]

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "POST":
            content_length = request.headers.get("content-length", "0")
            if int(content_length) > 65536:
                return self._error_response(413, "Request too large")
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    def _error_response(self, status: int, detail: str):
        from starlette.responses import JSONResponse
        return JSONResponse({"detail": detail}, status_code=status)

def validate_input(value: str) -> bool:
    if not value or len(value) > 1024:
        return False
    for pattern in BLOCKED_PATTERNS:
        if pattern.search(value):
            return False
    return True

def verify_admin_key(request: Request) -> bool:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    expected = hmac.new(
        API_SECRET.encode(),
        b"admin",
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(token, expected)

def require_admin(request: Request):
    if not verify_admin_key(request):
        raise HTTPException(401, "Unauthorized")
