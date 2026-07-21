#!/usr/bin/env python3
"""Small persistent Python kernel used by the APEX execution runtime."""
import ast
import io
import json
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout


def run_cell(namespace, code):
    output = io.StringIO()
    try:
        parsed = ast.parse(code, mode="exec")
    except SyntaxError:
        return "", None, traceback.format_exc(limit=1)
    body = parsed.body
    tail = None
    if body and isinstance(body[-1], ast.Expr):
        tail = ast.Expression(body.pop().value)
    try:
        with redirect_stdout(output), redirect_stderr(output):
            if body:
                exec(compile(ast.Module(body, []), "<cell>", "exec"), namespace)
            result = eval(compile(tail, "<cell>", "eval"), namespace) if tail else None
        return output.getvalue(), repr(result) if result is not None else None, None
    except Exception:
        return output.getvalue(), None, traceback.format_exc()


def main():
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    namespace = {"__name__": "__main__"}
    for line in sys.stdin:
        try:
            request = json.loads(line)
            stdout, result, error = run_cell(namespace, request.get("code", ""))
            response = {
                "id": request.get("id"),
                "ok": error is None,
                "stdout": stdout,
                "result": result,
                "error": error,
            }
            print(json.dumps(response), flush=True)
        except (json.JSONDecodeError, BrokenPipeError):
            continue


if __name__ == "__main__":
    main()
