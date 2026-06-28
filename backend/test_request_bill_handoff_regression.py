import importlib.util
import pathlib
import sys
import types
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parent / "api_server.py"


def _install_import_stubs():
    if "fastapi" not in sys.modules:
        fastapi_mod = types.ModuleType("fastapi")

        class _DummyFastAPI:
            def __init__(self, *args, **kwargs):
                self.routes = []
                pass

            def _decorator(self, *args, **kwargs):
                def wrap(func):
                    return func

                return wrap

            def get(self, *args, **kwargs):
                return self._decorator(*args, **kwargs)

            def post(self, *args, **kwargs):
                return self._decorator(*args, **kwargs)

            def patch(self, *args, **kwargs):
                return self._decorator(*args, **kwargs)

            def delete(self, *args, **kwargs):
                return self._decorator(*args, **kwargs)

            def put(self, *args, **kwargs):
                return self._decorator(*args, **kwargs)

            def add_middleware(self, *args, **kwargs):
                return None

            def include_router(self, *args, **kwargs):
                return None

            def mount(self, *args, **kwargs):
                return None

            def __getattr__(self, name):
                if name.startswith("_"):
                    raise AttributeError(name)
                return self._decorator

        class _HTTPException(Exception):
            def __init__(self, status_code: int, detail=None):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        def _identity(*args, **kwargs):
            if args and callable(args[0]) and len(args) == 1 and not kwargs:
                return args[0]

            def wrap(value=None):
                return value

            return wrap

        fastapi_mod.FastAPI = _DummyFastAPI
        fastapi_mod.File = _identity
        fastapi_mod.Query = _identity
        fastapi_mod.Request = object
        fastapi_mod.UploadFile = object
        fastapi_mod.HTTPException = _HTTPException
        sys.modules["fastapi"] = fastapi_mod

    if "fastapi.middleware.cors" not in sys.modules:
        cors_mod = types.ModuleType("fastapi.middleware.cors")

        class _CORSMiddleware:
            def __init__(self, *args, **kwargs):
                pass

        cors_mod.CORSMiddleware = _CORSMiddleware
        sys.modules["fastapi.middleware.cors"] = cors_mod

    if "fastapi.staticfiles" not in sys.modules:
        static_mod = types.ModuleType("fastapi.staticfiles")

        class _StaticFiles:
            def __init__(self, *args, **kwargs):
                pass

        static_mod.StaticFiles = _StaticFiles
        sys.modules["fastapi.staticfiles"] = static_mod

    if "fastapi.responses" not in sys.modules:
        responses_mod = types.ModuleType("fastapi.responses")

        class _Response:
            pass

        responses_mod.FileResponse = _Response
        responses_mod.JSONResponse = _Response
        responses_mod.PlainTextResponse = _Response
        responses_mod.RedirectResponse = _Response
        responses_mod.Response = _Response
        sys.modules["fastapi.responses"] = responses_mod

    if "starlette.concurrency" not in sys.modules:
        concurrency_mod = types.ModuleType("starlette.concurrency")
        concurrency_mod.run_in_threadpool = lambda func, *args, **kwargs: func(*args, **kwargs)
        sys.modules["starlette.concurrency"] = concurrency_mod

    if "starlette.middleware.gzip" not in sys.modules:
        gzip_mod = types.ModuleType("starlette.middleware.gzip")
        gzip_mod.GZipMiddleware = object
        sys.modules["starlette.middleware.gzip"] = gzip_mod

    if "pydantic" not in sys.modules:
        pydantic_mod = types.ModuleType("pydantic")

        class _BaseModel:
            pass

        def _model_validator(*args, **kwargs):
            def wrap(func):
                return func

            return wrap

        pydantic_mod.BaseModel = _BaseModel
        pydantic_mod.model_validator = _model_validator
        sys.modules["pydantic"] = pydantic_mod

    if "pyodbc" not in sys.modules:
        pyodbc_mod = types.ModuleType("pyodbc")
        pyodbc_mod.connect = lambda *args, **kwargs: None
        pyodbc_mod.Error = Exception
        sys.modules["pyodbc"] = pyodbc_mod

    if "config" not in sys.modules:
        config_mod = types.ModuleType("config")
        config_mod.get_connection_string = lambda: ""
        config_mod.get_connection_string_driver13 = lambda: ""
        config_mod.DATABASE = "TEST"
        sys.modules["config"] = config_mod

    if "redis" not in sys.modules:
        redis_mod = types.ModuleType("redis")
        redis_mod.from_url = lambda *args, **kwargs: None
        sys.modules["redis"] = redis_mod


def _load_api_server_module():
    _install_import_stubs()
    spec = importlib.util.spec_from_file_location("api_server_under_test", str(MODULE_PATH))
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load api_server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RequestBillHandoffRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = _load_api_server_module()

    def _run_request_bill(self, with_handoff_at: bool):
        now_iso = "2026-06-28T10:00:00"
        orders = [
            {
                "id": "order-1",
                "ticketNo": "T100",
                "sessionId": "session-1",
                "status": "ready",
                "items": [
                    {
                        "lineId": "line-1",
                        "name": "Soup",
                        "quantity": 1,
                        "unitPrice": 20,
                        "prepared": True,
                        "preparedQty": 1,
                        "sent": False,
                        "lineStatus": "ready",
                        "handoffAt": now_iso if with_handoff_at else None,
                    }
                ],
            }
        ]
        sessions = [{"id": "session-1"}]

        def fake_load(name, default=None):
            if name == "orders":
                return orders
            if name == "table_sessions":
                return sessions
            return default

        def fake_save(_name, _value):
            return None

        api = self.api
        originals = {
            "_restaurant_assert_order_taker_may_use_session": api._restaurant_assert_order_taker_may_use_session,
            "_restaurant_assert_same_captain_for_request_bill": api._restaurant_assert_same_captain_for_request_bill,
            "_restaurant_billing_session_ids": api._restaurant_billing_session_ids,
            "_restaurant_load": api._restaurant_load,
            "_restaurant_save": api._restaurant_save,
            "_approved_guest_return_qty_map_for_session": api._approved_guest_return_qty_map_for_session,
            "get_connection": api.get_connection,
        }

        try:
            api._restaurant_assert_order_taker_may_use_session = lambda *_a, **_k: None
            api._restaurant_assert_same_captain_for_request_bill = lambda *_a, **_k: None
            api._restaurant_billing_session_ids = lambda _sid: ["session-1"]
            api._restaurant_load = fake_load
            api._restaurant_save = fake_save
            api._approved_guest_return_qty_map_for_session = lambda _sid: {}
            api.get_connection = lambda: None

            with self.assertRaises(api.HTTPException) as ctx:
                api.restaurant_sessions_request_bill({"sessionId": "session-1"})
            return ctx.exception
        finally:
            for name, val in originals.items():
                setattr(api, name, val)

    def test_request_bill_blocks_when_order_not_delivered(self):
        ex = self._run_request_bill(with_handoff_at=False)
        self.assertEqual(ex.status_code, 409)
        self.assertIn("لا يمكن طلب الحساب", str(ex.detail))

    def test_request_bill_allows_handoff_item(self):
        ex = self._run_request_bill(with_handoff_at=True)
        # Not blocked by delivery validation; execution continues to DB connectivity.
        self.assertEqual(ex.status_code, 500)
        self.assertIn("فشل الاتصال", str(ex.detail))


if __name__ == "__main__":
    unittest.main()
