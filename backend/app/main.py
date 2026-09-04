from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.errors import DomainError, error_body


app = FastAPI(
    title="Tailored Outfit Platform API",
    version="1.0.0",
    description="Local-first deterministic adult shirt recommendation API.",
)
app.include_router(router)


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(content=error_body(exc.code, exc.message, exc.details), status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {
            "field": ".".join(str(part) for part in error["loc"] if part != "body"),
            "code": error["type"],
            "message": error["msg"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        content=error_body("REQUEST_VALIDATION_ERROR", "The request contains invalid fields", details),
        status_code=422,
    )
