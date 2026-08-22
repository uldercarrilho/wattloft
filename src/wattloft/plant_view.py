from __future__ import annotations

import asyncio
import hmac

from starlette.applications import Starlette
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from wattloft.history import history_is_empty

_LOGIN = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Plant</title></head>
<body>
<form method="post" action="/login">
<label>Password <input type="password" name="password" required></label>
<button type="submit">Log in</button>
</form>
</body>
</html>
"""

_EMPTY_HISTORY = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Plant</title></head>
<body>
<p>This Plant has no History yet.</p>
</body>
</html>
"""


def create_app(operator_password: str, database_url: str) -> Starlette:
    async def plant_view(request: Request) -> Response:
        if not request.session.get("operator"):
            return HTMLResponse(_LOGIN, status_code=401)
        await asyncio.to_thread(history_is_empty, database_url)
        return HTMLResponse(_EMPTY_HISTORY)

    async def login(request: Request) -> Response:
        form = await request.form()
        offered = form.get("password", "")
        if not isinstance(offered, str) or not hmac.compare_digest(
            offered, operator_password
        ):
            return HTMLResponse(_LOGIN, status_code=401)
        request.session["operator"] = True
        return RedirectResponse("/", status_code=303)

    app = Starlette(
        routes=[
            Route("/", plant_view),
            Route("/login", login, methods=["POST"]),
        ]
    )
    app.add_middleware(SessionMiddleware, secret_key=operator_password, https_only=False)
    return app
