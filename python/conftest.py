import json
import os
import shlex
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import List, Optional

import pytest


_COMPOSE_FILE = Path(__file__).parent / "tests" / "docker" / "docker-compose.integration.yml"
_DEFAULT_PORT = os.environ.get("OMNE_SDK_NODE_PORT", "18545")
_DEFAULT_URL = os.environ.get("OMNE_SDK_RPC_URL", f"http://127.0.0.1:{_DEFAULT_PORT}")


def _compose_command() -> List[str]:
    """Resolve the docker compose command segments."""
    candidate = os.environ.get("OMNE_DOCKER_COMPOSE_CMD", "docker compose")
    return shlex.split(candidate)


def _wait_for_rpc(url: str, timeout: float = 120.0) -> None:
    """Poll the Omne JSON-RPC endpoint until it responds successfully."""
    deadline = time.time() + timeout
    last_error: Optional[Exception] = None
    while time.time() < deadline:
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "omne_networkInfo",
            "params": [],
        }).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                data = json.load(response)
            if "result" in data:
                return
        except Exception as exc:  # pylint: disable=broad-except
            last_error = exc
            time.sleep(2)
        else:
            time.sleep(1)
    raise TimeoutError(f"Timed out waiting for Omne node at {url}") from last_error


@pytest.fixture(scope="session")
def omne_docker_node():
    """Spin up a dockerised Omne node for integration tests."""
    if os.environ.get("OMNE_SDK_ENABLE_DOCKER", "1") in {"0", "false", "False"}:
        pytest.skip("Docker-backed integration disabled via OMNE_SDK_ENABLE_DOCKER")

    if not shutil.which("docker"):
        pytest.skip("Docker CLI not available on PATH")

    if not _COMPOSE_FILE.exists():
        pytest.skip("Integration docker-compose file missing")

    compose_cmd = _compose_command()
    env = os.environ.copy()
    env.setdefault("OMNE_SDK_NODE_PORT", _DEFAULT_PORT)
    rpc_url = env.get("OMNE_SDK_RPC_URL", _DEFAULT_URL)
    env.setdefault("OMNE_SDK_RPC_URL", rpc_url)
    env.setdefault("COMPOSE_PROJECT_NAME", "omne_sdk_integration")

    base_state = _COMPOSE_FILE.parent / ".validator"
    for subdir in ("data", "config", "keys", "logs"):
        (base_state / subdir).mkdir(parents=True, exist_ok=True)

    up_command = compose_cmd + ["-f", str(_COMPOSE_FILE), "up"]
    if env.get("OMNE_SDK_SKIP_BUILD", "0") not in {"0", "false", "False"}:
        up_command.append("--no-build")
    up_command.extend(["-d", "validator"])
    try:
        result = subprocess.run(up_command, check=False, capture_output=True, env=env, text=True)
        if result.returncode != 0:
            pytest.skip(
                "Failed to start Omne docker node:\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        try:
            _wait_for_rpc(rpc_url)
        except TimeoutError as exc:
            logs_command = compose_cmd + ["-f", str(_COMPOSE_FILE), "logs", "validator"]
            logs = subprocess.run(logs_command, check=False, capture_output=True, env=env, text=True)
            pytest.skip(
                "Omne docker node did not become ready:\n"
                f"error: {exc}\n"
                f"logs:\n{logs.stdout}\n{logs.stderr}"
            )

        os.environ["OMNE_SDK_RPC_URL"] = rpc_url
        yield
    finally:
        down_command = compose_cmd + ["-f", str(_COMPOSE_FILE), "down", "-v"]
        subprocess.run(down_command, check=False, env=env)
