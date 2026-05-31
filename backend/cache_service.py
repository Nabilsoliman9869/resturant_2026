# backend/cache_service.py
# Hybrid cache: Redis (preferred) → in-memory dict (fallback)
# Ensures caching works even if Redis is full/down.

import os
import json
import time
import threading

_LOCK = threading.RLock()

# ── In-memory fallback ──────────────────────────────────
_mem_cache: dict = {}   # key -> {"data": ..., "expires": float}

try:
    import redis
except Exception:
    redis = None  # type: ignore

REDIS_URL = os.getenv("REDIS_URL", "").strip()
_client = None          # None = not initialized yet, False = failed


def _get_client():
    global _client
    if _client is not None:
        return _client if _client else None
    if not redis or not REDIS_URL:
        print(f"[cache] REDIS_URL not set ({REDIS_URL=}, {redis=}). Using in-memory fallback.")
        _client = False
        return None
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True,
                           socket_connect_timeout=5, socket_timeout=5,
                           socket_keepalive=True, health_check_interval=30)
        r.ping()
        _client = r
        host = REDIS_URL.rsplit("@", 1)[-1]
        print(f"[cache] Redis connected: {host}")
        return _client
    except Exception as e:
        print(f"[cache] Redis unavailable ({e}). Using in-memory fallback.")
        _client = False
        return None


def _mem_get(key: str):
    with _LOCK:
        entry = _mem_cache.get(key)
        if not entry:
            return None
        if time.time() > entry["expires"]:
            _mem_cache.pop(key, None)
            return None
        return entry["data"]


def _mem_set(key: str, data, ttl: int):
    with _LOCK:
        _mem_cache[key] = {"data": data, "expires": time.time() + ttl}


def _mem_delete(key: str):
    with _LOCK:
        _mem_cache.pop(key, None)


def _mem_delete_pattern(pattern: str):
    # pattern like "mat3am:restaurant:*"
    prefix = pattern.rstrip("*")
    with _LOCK:
        keys_to_del = [k for k in _mem_cache if k.startswith(prefix)]
        for k in keys_to_del:
            _mem_cache.pop(k, None)


# ── Public API ────────────────────────────────────────────
def cache_enabled() -> bool:
    return True   # always enabled (in-memory at minimum)


def cache_get(key: str):
    # try Redis first
    r = _get_client()
    if r:
        try:
            v = r.get(key)
            if v:
                print(f"[cache] HIT  {key} (redis)")
                return json.loads(v)
        except Exception as e:
            print(f"[cache] Redis get error: {e}. Falling back to memory.")
            global _client
            _client = None

    # fallback: in-memory
    val = _mem_get(key)
    if val is not None:
        print(f"[cache] HIT  {key} (memory)")
        return val
    print(f"[cache] MISS {key}")
    return None


def cache_set(key: str, data, ttl: int = 10):
    r = _get_client()
    if r:
        try:
            r.setex(key, ttl, json.dumps(data, ensure_ascii=False))
            print(f"[cache] SET  {key} (redis, ttl={ttl}s)")
            return
        except Exception as e:
            print(f"[cache] Redis set error: {e}. Storing in memory.")
            global _client
            _client = None

    # fallback: in-memory
    _mem_set(key, data, ttl)
    print(f"[cache] SET  {key} (memory, ttl={ttl}s)")


def cache_delete(key: str):
    r = _get_client()
    if r:
        try:
            r.delete(key)
        except Exception:
            global _client
            _client = None
    _mem_delete(key)


def cache_delete_pattern(pattern: str):
    r = _get_client()
    if r:
        try:
            for k in r.scan_iter(match=pattern):
                r.delete(k)
        except Exception:
            global _client
            _client = None
    _mem_delete_pattern(pattern)


def cache_invalidate_restaurant():
    """Invalidate all restaurant-scoped keys after writes."""
    cache_delete_pattern("mat3am:restaurant:*")


def _mem_cleanup_expired():
    """Periodically remove expired in-memory entries."""
    now = time.time()
    with _LOCK:
        expired = [k for k, v in _mem_cache.items() if now > v["expires"]]
        for k in expired:
            _mem_cache.pop(k, None)


# kick off a tiny background cleaner every 30s
def _cleanup_worker():
    while True:
        time.sleep(30)
        try:
            _mem_cleanup_expired()
        except Exception:
            pass

threading.Thread(target=_cleanup_worker, daemon=True, name="cache-cleanup").start()
