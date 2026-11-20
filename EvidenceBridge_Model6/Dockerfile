# EvidenceBridge Model 6 — MobileNetV3-Small Document Classifier
FROM python:3.12-slim

WORKDIR /app

# Install minimal OS runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Model 6 files
COPY model/ model/
COPY config/ config/
COPY inference/ inference/
COPY evaluation/ evaluation/

ENV PYTHONUNBUFFERED=1

# Default verification command
CMD ["python", "inference/predict.py", "--help"]
