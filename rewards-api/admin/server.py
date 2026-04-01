"""
Admin Panel Server
Serves the admin HTML and proxies to the main API
"""

import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="NONOS Rewards Admin Panel")

TEMPLATE_DIR = Path(__file__).parent / "templates"

@app.get("/")
async def index():
    return FileResponse(TEMPLATE_DIR / "index.html")

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
