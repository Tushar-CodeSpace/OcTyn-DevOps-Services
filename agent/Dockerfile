FROM python:3.14-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uv/bin/uv

COPY pyproject.toml .
COPY agent ./agent
COPY main.py .

RUN /uv/bin/uv pip install --system --no-cache .

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "agent.app"]