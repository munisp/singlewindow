FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py anomaly_detector.py model_store.py shadow_model.py retrain_scheduler.py ./
EXPOSE 8093
# PORT is env-configurable; defaults to 8093 (see k8s deployment)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8093}"]
