from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import (
    admin,
    analytics,
    catalogue,
    emergency,
    medical,
    payments,
    profile,
    provider,
    requests,
)

app = FastAPI(title="CareConnect API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


app.include_router(catalogue.router)
app.include_router(profile.router)
app.include_router(requests.router)
app.include_router(emergency.router)
app.include_router(medical.router)
app.include_router(payments.router)
app.include_router(analytics.router)
app.include_router(provider.router)
app.include_router(admin.router)
