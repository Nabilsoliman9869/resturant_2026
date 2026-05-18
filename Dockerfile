# مطاعم — Railway: React + FastAPI + Microsoft ODBC 18 لـ SQL Server
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.*.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm

# Microsoft ODBC Driver 18 + unixODBC (مطلوب لـ pyodbc على Linux)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl gnupg apt-transport-https ca-certificates \
    unixodbc unixodbc-dev g++ \
  && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
    > /etc/apt/sources.list.d/mssql-release.list \
  && apt-get update \
  && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql17 msodbcsql18 \
  && rm -rf /var/lib/apt/lists/*

# OpenSSL 3: legacy sigalg + TLS قديم لـ SQL Server على 41.x (Railway ↔ ODBC 18)
RUN printf '%s\n' \
  'openssl_conf = openssl_init' \
  '' \
  '[openssl_init]' \
  'providers = provider_sect' \
  'ssl_conf = ssl_sect' \
  '' \
  '[provider_sect]' \
  'default = default_sect' \
  'legacy = legacy_sect' \
  '' \
  '[default_sect]' \
  'activate = 1' \
  '' \
  '[legacy_sect]' \
  'activate = 1' \
  '' \
  '[ssl_sect]' \
  'system_default = system_default_sect' \
  '' \
  '[system_default_sect]' \
  'MinProtocol = TLSv1' \
  'CipherString = DEFAULT@SECLEVEL=0' \
  > /etc/ssl/openssl_mat3am.cnf
ENV OPENSSL_CONF=/etc/ssl/openssl_mat3am.cnf

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend /app/ui/restaurant ./ui/restaurant

ENV MAT3AM_BASE_DIR=/data
WORKDIR /app/backend
CMD ["python", "api_server.py"]
