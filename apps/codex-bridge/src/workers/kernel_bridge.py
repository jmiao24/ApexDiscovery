#!/usr/bin/env python3
"""Small persistent Python kernel used by the APEX execution runtime."""
import ast
import io
import json
import os
import socket
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout


def install_network_broker():
    """Route urllib/requests TCP connections through APEX's allowlisted socket."""
    broker_path = os.environ.get("APEX_NETWORK_BROKER_SOCKET")
    if not broker_path:
        return

    original_create_connection = socket.create_connection

    class BrokerSocket(socket.socket):
        """A real socket that ignores HTTPConnection's TCP-only optimization."""

        def setsockopt(self, level, optname, value, *args):
            if level == socket.IPPROTO_TCP and optname == socket.TCP_NODELAY:
                return None
            return super().setsockopt(level, optname, value, *args)

    def broker_create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT,
                                 source_address=None, *args, **kwargs):
        host, port = address[:2]
        if source_address is not None or not isinstance(host, str):
            return original_create_connection(address, timeout, source_address, *args, **kwargs)
        tunneled = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
            tunneled.settimeout(timeout)
        try:
            tunneled.connect(broker_path)
            handshake = json.dumps({"host": host, "port": int(port)}).encode("utf-8") + b"\n"
            tunneled.sendall(handshake)
            response = bytearray()
            while not response.endswith(b"\n"):
                chunk = tunneled.recv(1)
                if not chunk or len(response) >= 4096:
                    raise OSError("APEX network broker closed during handshake")
                response.extend(chunk)
            result = json.loads(response.decode("utf-8"))
            if not result.get("ok"):
                raise OSError(result.get("error") or "APEX network broker denied the connection")
            return BrokerSocket(
                family=socket.AF_UNIX,
                type=socket.SOCK_STREAM,
                proto=0,
                fileno=tunneled.detach(),
            )
        except Exception:
            tunneled.close()
            raise

    socket.create_connection = broker_create_connection
    try:
        from urllib3.util import connection as urllib3_connection
        urllib3_connection.create_connection = broker_create_connection
    except ImportError:
        pass


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
    install_network_broker()
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
