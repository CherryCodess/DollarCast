FROM python:3.11-slim
WORKDIR /service
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl libeccodes0 && rm -rf /var/lib/apt/lists/*
COPY apps/weather-service/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/weather-service .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
