"""Software Deployment Runner for remote site agents.

Pulls deployment jobs from central hub, executes multi-stage deployments
(Node v24 monorepo with PM2, PHP with Nginx, client & machine MongoDB configs),
and streams live stdout/stderr execution logs back to the hub.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

from agent.config import API_KEY, API_URL, http_timeout, log
from agent.transport import push

_ACTIVE_DEPLOYMENT: Optional[str] = None


def _stream_log(deployment_id: str, stage: str, line: str, level: str = "info") -> None:
    """Stream a single log line to the central hub for live dashboard rendering."""
    try:
        req = Request(
            f"{API_URL}/deployments/{deployment_id}/stream",
            data=json.dumps({"stage": stage, "line": str(line).strip(), "level": level}).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            method="POST",
        )
        with urlopen(req, timeout=5) as resp:
            pass
    except Exception:
        pass


def _finish_deployment(deployment_id: str, status: str, exit_code: int, duration_seconds: float, error_summary: Optional[str] = None) -> None:
    """Notify central hub that deployment has completed."""
    try:
        req = Request(
            f"{API_URL}/deployments/{deployment_id}/finish",
            data=json.dumps({
                "status": status,
                "exit_code": exit_code,
                "duration_seconds": round(duration_seconds, 2),
                "error_summary": error_summary,
            }).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            method="POST",
        )
        with urlopen(req, timeout=10) as resp:
            pass
    except Exception as exc:
        log(f"[DEPLOY] Error reporting finish status: {exc!r}")


def _run_streaming_command(cmd: str, cwd: Optional[str], deployment_id: str, stage: str, env: Optional[Dict[str, str]] = None) -> int:
    """Run a shell command and stream each output line live back to hub."""
    _stream_log(deployment_id, stage, f"$ {cmd} (cwd: {cwd or os.getcwd()})", level="info")
    
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    try:
        process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=cwd,
            env=full_env,
        )

        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.rstrip()
            if line:
                level = "error" if "error" in line.lower() or "fatal" in line.lower() else "info"
                _stream_log(deployment_id, stage, line, level=level)

        process.wait()
        rc = process.returncode
        if rc == 0:
            _stream_log(deployment_id, stage, f"Command completed successfully (code 0)", level="success")
        else:
            _stream_log(deployment_id, stage, f"Command failed with exit code {rc}", level="error")
        return rc
    except Exception as exc:
        _stream_log(deployment_id, stage, f"Command execution exception: {exc}", level="error")
        return 1


def _execute_deployment(job: Dict[str, Any]) -> None:
    global _ACTIVE_DEPLOYMENT
    deployment_id = job.get("deployment_id", "")
    _ACTIVE_DEPLOYMENT = deployment_id
    start_time = time.time()

    sw_name = job.get("software_name", "Software")
    components = job.get("components", [])
    config_repo = job.get("config_repo")
    branches = job.get("branches", {})
    client_name = job.get("client_name", "")
    machine_type = job.get("machine_type", "")

    log(f"[DEPLOY] Starting deployment for '{sw_name}' (ID: {deployment_id})")
    _stream_log(deployment_id, "INIT", f"=== Starting Deployment: {sw_name} ===", level="info")
    _stream_log(deployment_id, "INIT", f"Target client: '{client_name}' | Machine: '{machine_type}'", level="info")

    try:
        # Stage 1: Environment & Dependency Pre-Checks
        _stream_log(deployment_id, "PRECHECK", "Checking system tools and runtime environments...", level="info")

        if not shutil.which("git"):
            _stream_log(deployment_id, "PRECHECK", "git is missing! Attempting installation...", level="warn")
            if shutil.which("apt-get"):
                _run_streaming_command("sudo apt-get update -qq && sudo apt-get install -y git", None, deployment_id, "PRECHECK")

        # Check if any component requires Node.js / PM2
        needs_node = any(c.get("type") == "nodejs_monorepo" for c in components)
        if needs_node:
            _stream_log(deployment_id, "PRECHECK", "Checking Node.js v24 and PM2...", level="info")
            node_ver_cmd = "node -v"
            rc = subprocess.run(node_ver_cmd, shell=True, capture_output=True, text=True)
            cur_ver = rc.stdout.strip()
            _stream_log(deployment_id, "PRECHECK", f"Current Node.js version: {cur_ver or 'None'}", level="info")

            if not cur_ver.startswith("v24"):
                _stream_log(deployment_id, "PRECHECK", "Node.js v24 required. Attempting installation via NodeSource...", level="warn")
                setup_node = "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
                _run_streaming_command(setup_node, None, deployment_id, "PRECHECK")

            # Check PM2
            if not shutil.which("pm2"):
                _stream_log(deployment_id, "PRECHECK", "PM2 not found globally. Installing PM2...", level="warn")
                _run_streaming_command("sudo npm install -g pm2", None, deployment_id, "PRECHECK")

        # Check if any component requires PHP / Nginx
        needs_php = any(c.get("type") == "php_nginx" for c in components)
        if needs_php:
            _stream_log(deployment_id, "PRECHECK", "Checking PHP and Nginx...", level="info")
            if not shutil.which("nginx"):
                _stream_log(deployment_id, "PRECHECK", "nginx missing. Installing nginx...", level="warn")
                _run_streaming_command("sudo apt-get update -qq && sudo apt-get install -y nginx", None, deployment_id, "PRECHECK")
            if not shutil.which("php"):
                _stream_log(deployment_id, "PRECHECK", "php missing. Installing php-fpm...", level="warn")
                _run_streaming_command("sudo apt-get install -y php-fpm php-cli composer", None, deployment_id, "PRECHECK")

        # Stage 2: Git Repository Cloning & Updating
        for c in components:
            c_name = c.get("name", "Component")
            repo_url = c.get("repo_url", "")
            target_dir = c.get("target_dir", f"/opt/{sw_name}/{c_name.lower().replace(' ', '_')}")
            branch = branches.get(c_name) or c.get("default_branch", "main")

            _stream_log(deployment_id, "GIT", f"Syncing repository for '{c_name}' -> {target_dir} (branch: {branch})", level="info")

            parent_dir = os.path.dirname(target_dir)
            os.makedirs(parent_dir, exist_ok=True)

            if os.path.exists(os.path.join(target_dir, ".git")):
                _stream_log(deployment_id, "GIT", f"Existing Git repository found in {target_dir}. Pulling latest...", level="info")
                git_pull = f"git fetch origin && git checkout {branch} && git pull origin {branch}"
                rc = _run_streaming_command(git_pull, target_dir, deployment_id, "GIT")
                if rc != 0:
                    raise RuntimeError(f"Git pull failed for '{c_name}'")
            else:
                _stream_log(deployment_id, "GIT", f"Cloning {repo_url} into {target_dir}...", level="info")
                git_clone = f"git clone --branch {branch} {repo_url} {target_dir}"
                rc = _run_streaming_command(git_clone, None, deployment_id, "GIT")
                if rc != 0:
                    raise RuntimeError(f"Git clone failed for '{c_name}'")

        # Stage 3: Client & Machine-Specific Config Import
        if config_repo and config_repo.get("repo_url"):
            cfg_target = config_repo.get("target_dir", f"/opt/{sw_name}/configs")
            cfg_branch = branches.get("Config") or config_repo.get("default_branch", "main")
            _stream_log(deployment_id, "CONFIG", f"Syncing configs repo -> {cfg_target} (branch: {cfg_branch})", level="info")

            os.makedirs(os.path.dirname(cfg_target), exist_ok=True)
            if os.path.exists(os.path.join(cfg_target, ".git")):
                _run_streaming_command(f"git fetch origin && git checkout {cfg_branch} && git pull origin {cfg_branch}", cfg_target, deployment_id, "CONFIG")
            else:
                _run_streaming_command(f"git clone --branch {cfg_branch} {config_repo['repo_url']} {cfg_target}", None, deployment_id, "CONFIG")

            # Execute import script if configured
            import_script = config_repo.get("import_script", "")
            if import_script:
                formatted_script = import_script.replace("{client}", client_name).replace("{machine_type}", machine_type)
                _stream_log(deployment_id, "CONFIG", f"Applying machine configs: {formatted_script}", level="info")
                rc = _run_streaming_command(formatted_script, cfg_target, deployment_id, "CONFIG")
                if rc != 0:
                    _stream_log(deployment_id, "CONFIG", "Warning: Config import script returned non-zero code", level="warn")

        # Stage 4: Component Builds & Service Execution
        for c in components:
            c_name = c.get("name", "Component")
            target_dir = c.get("target_dir")
            build_cmd = c.get("build_command")
            start_cmd = c.get("start_command")
            env_vars = c.get("env_vars", {})

            # Run build command if defined
            if build_cmd:
                _stream_log(deployment_id, "BUILD", f"Running build for '{c_name}'...", level="info")
                rc = _run_streaming_command(build_cmd, target_dir, deployment_id, "BUILD", env=env_vars)
                if rc != 0:
                    raise RuntimeError(f"Build command failed for '{c_name}'")

            # Run start/restart command if defined
            if start_cmd:
                _stream_log(deployment_id, "START", f"Starting/Reloading service for '{c_name}'...", level="info")
                rc = _run_streaming_command(start_cmd, target_dir, deployment_id, "START", env=env_vars)
                if rc != 0:
                    raise RuntimeError(f"Service start/reload failed for '{c_name}'")

        duration = time.time() - start_time
        _stream_log(deployment_id, "VERIFY", f"=== Deployment Successful in {duration:.1f}s ===", level="success")
        _finish_deployment(deployment_id, "success", 0, duration)
        log(f"[DEPLOY] Deployment '{deployment_id}' SUCCESS ({duration:.1f}s)")

    except Exception as exc:
        duration = time.time() - start_time
        err_msg = str(exc)
        log(f"[DEPLOY] Deployment '{deployment_id}' FAILED: {err_msg}")
        _stream_log(deployment_id, "ERROR", f"=== Deployment Failed: {err_msg} ===", level="error")
        _finish_deployment(deployment_id, "failed", 1, duration, error_summary=err_msg)

    finally:
        _ACTIVE_DEPLOYMENT = None


def poll_deployment_job() -> None:
    """Poll central hub for any pending deployment assigned to this site server."""
    global _ACTIVE_DEPLOYMENT
    if _ACTIVE_DEPLOYMENT:
        return  # Already running a deployment

    req = Request(
        f"{API_URL}/deployments/poll",
        headers={"X-API-Key": API_KEY},
    )
    try:
        with urlopen(req, timeout=min(http_timeout(), 6)) as resp:
            data = json.loads(resp.read(50000) or b"{}")
    except (URLError, OSError, ValueError):
        return

    job = data.get("job")
    if job and isinstance(job, dict):
        # Spawn deployment in a dedicated thread
        t = threading.Thread(
            target=_execute_deployment,
            args=(job,),
            name=f"deploy-{job.get('deployment_id', 'job')}",
            daemon=True,
        )
        t.start()


def start_deployment_poller() -> None:
    """Background loop polling for deployment jobs."""
    def _poll() -> None:
        while True:
            try:
                poll_deployment_job()
            except Exception as exc:
                log(f"[DEPLOY] Poller exception: {exc!r}")
            time.sleep(5)

    threading.Thread(target=_poll, name="deploy-poller", daemon=True).start()
