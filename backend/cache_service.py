# backend/cache_service.py
# Optional Redis cache layer. Falls back to no-cache silently.
# Usage: wrap heavy GET endpoints; invalidate on POST/PATCH/DELETE.

import os
import json

try:
    import redis
except Exception:
    redis = None  # type: ignore

REDIS_URL = os.getenv("REDIS_URL", "").strip()
_client = None  # None = not initialized yet, False = failed/unavailable


def _get_client():
    global _client
    if _client is not None:
        return _client if _client else None
    if not redis or not REDIS_URL:
        print(f"[cache] REDIS_URL not set ({REDIS_URL=}, {redis=}). Running without cache.")
        _client = False
        return None
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
        r.ping()
        _client = r
        host = REDIS_URL.rsplit("@", 1)[-1]
        print(f"[cache] Redis connected: {host}")
        return _client
    except Exception as e:
        print(f"[cache] Redis unavailable ({e}). Running without cache.")
        _client = False
        return None


def cache_enabled() -> bool:
    return _get_client() is not None


def cache_get(key: str):
    r = _get_client()
    if not r:
        return None
    try:
        v = r.get(key)
        return json.loads(v) if v else None
    except Exception:
        return None


def cache_set(key: str, data, ttl: int = 10):
    r = _get_client()
    if not r:
        return
    try:
        r.setex(key, ttl, json.dumps(data, ensure_ascii=False))
    except Exception:
        pass


def cache_delete(key: str):
    r = _get_client()
    if not r:
        return
    try:
        r.delete(key)
    except Exception:
        pass


def cache_delete_pattern(pattern: str):
    r = _get_client()
    if not r:
        return
    try:
        for k in r.scan_iter(match=pattern):
            r.delete(k)
    except Exception:
        pass


def cache_invalidate_restaurant():
    """Invalidate all restaurant-scoped keys after writes."""
    cache_delete_pattern("mat3am:restaurant:*")
