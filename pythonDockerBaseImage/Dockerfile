# Python services container — StoryCreator automation agents
FROM python:3.14-alpine

# Create non-root user
RUN addgroup -g 1000 appuser && \
    adduser -u 1000 -G appuser -D appuser

WORKDIR /app

# CA certificates are required for HTTPS calls to the StoryCreator API and OpenAI
RUN apk add --no-cache ca-certificates

# Create virtual environment (as root) and use it
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Disable Python output buffering
ENV PYTHONUNBUFFERED=1

# Install dependencies
COPY pythonDockerBaseImage/requirements.txt base-requirements.txt
COPY DialectHubAgent/requirements.txt agent-requirements.txt
RUN pip install --no-cache-dir -r base-requirements.txt -r agent-requirements.txt

# Switch to non-root user
USER appuser

# Copy application code (with correct ownership)
COPY --chown=appuser:appuser DialectHubAgent/StoryCreatorAgent.py .

# Default command — pass CLI flags after the image name
CMD ["python", "-u", "StoryCreatorAgent.py"]