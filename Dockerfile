FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY member_portfolio_service.py .

EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--worker-class", "gthread", "--workers", "1", "--threads", "32", "--timeout", "0", "--access-logfile", "-", "--error-logfile", "-", "member_portfolio_service:create_app()"]