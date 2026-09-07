from fastapi import FastAPI

app = FastAPI(title="aboutme")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
