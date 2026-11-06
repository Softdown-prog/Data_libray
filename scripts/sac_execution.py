"""SAC-008C: opt-in, bounded dispatch of received jobs to a trusted SAC auditor.

The job never specifies executable, shell, network, image, manifest, or paths.
The operator's separate registry selects a fixed, installed auditor. This stage
audits a pre-built, attested Angular dist; it does not build external source.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
from pathlib import Path

if __package__:
    from . import sac_job_queue
else:
    import sac_job_queue

RESULT_KEYS = frozenset({
    "schema_version", "job_id", "project_id", "profile_id", "source_sha",
    "status", "static_pipeline_pass", "browser_pass", "deployment_authorized",
    "execution", "code",
})
DIAGNOSTIC_KEYS = frozenset({"schema_version", "status", "checks", "findings",
                             "truncated", "location_verified", "deployment_authorized"})
FINDING_KEYS = frozenset({"phase", "status", "code", "assertion", "title", "next_step"})
CHECKS = frozenset({"pre", "build", "post", "browser"})
STATUS = frozenset({"pass", "fail", "unverified", "infra-error"})
CODE = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
MAX_REPORT = 8192
MAX_ONE_JOB = 180

TECHNICAL_KEYS = frozenset({
    "schema_version", "job_id", "project_id", "profile_id", "source_sha",
    "status", "phase", "exit_code", "findings", "truncated", "post_status",
    "browser_status", "root_cause_verified", "deployment_authorized", "text"
})
TECHNICAL_FINDING_KEYS = frozenset({
    "tool", "code", "file", "line", "column", "message", "location_verified"
})
DIAGNOSTIC_CODE = re.compile(r"(?:TS|NG)[0-9]{4,5}\Z")
DIAGNOSTIC_FILE = re.compile(r"(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.(?:tsx?|html)\Z")
TS_DESCRIPTIONS = {
    "TS2322": "O compilador TypeScript registrou atribuição entre tipos incompatíveis.",
    "TS2307": "O compilador TypeScript registrou que não encontrou um módulo.",
    "TS2304": "O compilador TypeScript registrou um identificador não encontrado.",
    "TS2339": "O compilador TypeScript registrou uma propriedade não reconhecida.",
}
TS_GENERIC = "O compilador Angular registrou um erro TypeScript."
ANGULAR_GENERIC = "O compilador Angular registrou um diagnóstico NG."


def _validate_technical_report(value, raw):
    if (type(value) is not dict or set(value) != TECHNICAL_KEYS
            or value["schema_version"] != 2 or value["status"] != "fail"
            or value["phase"] != "build"
            or type(value["exit_code"]) is not int or not 1 <= value["exit_code"] <= 255
            or type(value["truncated"]) is not bool
            or value["post_status"] != "not-run"
            or value["browser_status"] != "not-run"
            or value["root_cause_verified"] is not False
            or value["deployment_authorized"] is not False
            or type(value["text"]) is not str
            or type(value["findings"]) is not list
            or not 1 <= len(value["findings"]) <= 4):
        raise ValueError("invalid-technical-report")
    for k in ("job_id", "project_id", "profile_id", "source_sha"):
        if value[k] != raw[k]:
            raise ValueError("technical-report-identity-mismatch")
    lines = [
        f'Projeto {value["project_id"]}, commit {value["source_sha"]}.',
        f'A compilação Angular não foi concluída. Código de saída: {value["exit_code"]}.',
    ]
    for finding in value["findings"]:
        if (type(finding) is not dict or set(finding) != TECHNICAL_FINDING_KEYS
                or type(finding["code"]) is not str or not DIAGNOSTIC_CODE.fullmatch(finding["code"])
                or finding["tool"] != ("angular" if finding["code"].startswith("NG") else "typescript")
                or type(finding["location_verified"]) is not bool
                or finding["message"] != (ANGULAR_GENERIC if finding["code"].startswith("NG") else
                                          TS_DESCRIPTIONS.get(finding["code"], TS_GENERIC))):
            raise ValueError("invalid-technical-finding")
        if finding["location_verified"]:
            f = finding["file"]
            if (type(f) is not str or len(f) > 200 or not DIAGNOSTIC_FILE.fullmatch(f)
                    or (finding["tool"] == "typescript" and not re.search(r"\.tsx?\Z", f))
                    or any(segment in (".", "..", ".git", "node_modules", ".env")
                           or segment.startswith(".env.") for segment in f.split("/"))
                    or type(finding["line"]) is not int or not 1 <= finding["line"] <= 1000000
                    or type(finding["column"]) is not int or not 1 <= finding["column"] <= 10000):
                raise ValueError("untrusted-source-location")
            where = (f' no arquivo {f}, linha {finding["line"]},'
                     f' coluna {finding["column"]}')
        else:
            if (finding["file"] is not None or finding["line"] is not None
                    or finding["column"] is not None):
                raise ValueError("invented-source-location")
            where = " (arquivo e posição não confirmados)"
        lines.append(f'Erro {finding["code"]}{where}. {finding["message"]}')
    if value["truncated"]:
        lines.append("Existem outras ocorrências omitidas pelo limite do coletor.")
    lines.extend([
        "Pré-compilação: aprovada. Pós-compilação e Guardian: não executados porque o build falhou.",
        "Este relatório registra eventos observados e não determina a causa raiz.",
    ])
    if (value["text"] != "\n".join(lines)
            or len(json.dumps(value, ensure_ascii=True)) > 4096):
        raise ValueError("untrusted-technical-text")




def load_registry(value):
    if type(value) is not dict or set(value) != {"schema_version", "projects"}:
        raise ValueError("invalid-executor-policy")
    projects = value["projects"]
    if type(value["schema_version"]) is not int or value["schema_version"] != 1 or type(projects) is not list or len(projects) > 128:
        raise ValueError("invalid-executor-policy")
    result = {}
    for entry in projects:
        if type(entry) is not dict or set(entry) != {"project_id", "profile_id", "manifest"}:
            raise ValueError("invalid-executor-policy")
        pair = (entry["project_id"], entry["profile_id"])
        if not all(type(v) is str and sac_job_queue.SLUG.fullmatch(v) for v in pair):
            raise ValueError("invalid-executor-policy")
        manifest = entry["manifest"]
        if (type(manifest) is not str or not manifest.startswith("/")
                or "\x00" in manifest or ".." in Path(manifest).parts
                or len(manifest) > 512 or pair in result):
            raise ValueError("invalid-executor-policy")
        result[pair] = manifest
    return result


def _result(job, status="unverified", code="not-executed", *, static=False, browser=False):
    return {
        "schema_version": 1, "job_id": job["job_id"], "project_id": job["project_id"],
        "profile_id": job["profile_id"], "source_sha": job["source_sha"],
        "status": status, "static_pipeline_pass": static, "browser_pass": browser,
        "deployment_authorized": False, "execution": "sac-audit", "code": code,
    }


def _validate_diagnostic(value, expected_status):
    if type(value) is not dict or set(value) != DIAGNOSTIC_KEYS:
        raise ValueError("invalid-diagnostic-schema")
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["status"] != expected_status or value["status"] not in STATUS
            or type(value["truncated"]) is not bool
            or value["location_verified"] is not False
            or value["deployment_authorized"] is not False):
        raise ValueError("invalid-diagnostic-status")
    checks = value["checks"]
    if type(checks) is not dict or set(checks) != CHECKS or any(
            type(v) is not str or v not in STATUS for v in checks.values()):
        raise ValueError("invalid-diagnostic-checks")
    findings = value["findings"]
    if type(findings) is not list or len(findings) > 8:
        raise ValueError("invalid-diagnostic-count")
    for item in findings:
        if type(item) is not dict or set(item) != FINDING_KEYS:
            raise ValueError("invalid-diagnostic-finding")
        if (item["phase"] not in CHECKS or item["status"] not in STATUS or
                type(item["code"]) is not str or CODE.fullmatch(item["code"]) is None or
                (item["assertion"] is not None and (
                    type(item["assertion"]) is not str or
                    re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,63}", item["assertion"]) is None))):
            raise ValueError("invalid-diagnostic-code")
        for field, maximum in (("title", 95), ("next_step", 170)):
            value_text = item[field]
            if (type(value_text) is not str or not 4 <= len(value_text) <= maximum or
                    any(c in value_text for c in ("\n", "\r", "\x00", "\\", "<", ">")) or
                    "://" in value_text):
                raise ValueError("invalid-diagnostic-text")
    if len(json.dumps(value, ensure_ascii=True)) > 4096:
        raise ValueError("diagnostic-too-large")


def _normalize(job, raw):
    accepted = (RESULT_KEYS, RESULT_KEYS | {"diagnostic"},
                RESULT_KEYS | {"diagnostic", "technical_report"})
    if (type(raw) is not dict or set(raw) not in accepted
            or raw["schema_version"] != 1):
        raise ValueError("invalid-auditor-report")
    for name in ("job_id", "project_id", "profile_id", "source_sha"):
        if raw[name] != job[name]:
            raise ValueError("report-identity-mismatch")
    if (raw["status"] not in STATUS or type(raw["static_pipeline_pass"]) is not bool
            or type(raw["browser_pass"]) is not bool
            or raw["deployment_authorized"] is not False
            or raw["execution"] not in ("sac-audit", "sac-build-audit")
            or type(raw["code"]) is not str or CODE.fullmatch(raw["code"]) is None):
        raise ValueError("invalid-auditor-report")
    if raw["browser_pass"] and not raw["static_pipeline_pass"]:
        raise ValueError("invalid-auditor-coverage")
    if raw["status"] == "pass" and not (raw["static_pipeline_pass"] and raw["browser_pass"] and
            raw["code"] == ("isolated-build-browser-pass" if raw["execution"] == "sac-build-audit"
                            else "isolated-browser-pass")):
        raise ValueError("false-pass")
    if "diagnostic" in raw:
        _validate_diagnostic(raw["diagnostic"], raw["status"])
    if "technical_report" in raw:
        if (raw["execution"] != "sac-build-audit"
                or raw["status"] != "fail" or raw["code"] != "angular-compiler-failed"
                or raw["static_pipeline_pass"] or raw["browser_pass"]
                or raw["diagnostic"]["checks"] != {
                    "pre": "pass", "build": "fail",
                    "post": "unverified", "browser": "unverified"}):
            raise ValueError("inconsistent-technical-report")
        _validate_technical_report(raw["technical_report"], raw)
    return raw


def _invoke(job, manifest, *, executor, timeout, enable_build=False, docker_host=None):
    command = [executor, str(Path(__file__).with_name("sac_supervised_runner.mjs")),
               "--manifest", manifest]
    if enable_build:
        command.append("--enable-build")
    # No input data, credentials or paths from the GitHub Issue become shell args.
    if timeout < 10 or timeout > MAX_ONE_JOB:
        raise ValueError("invalid-execution-timeout")
    environ = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": "/tmp"}
    if docker_host is not None:
        if (type(docker_host) is not str or
                re.fullmatch(r"unix:///run/user/[1-9][0-9]{0,9}/docker\.sock", docker_host) is None):
            raise ValueError("invalid-rootless-docker-host")
        environ["DOCKER_HOST"] = docker_host
        environ["SAC_ROOTLESS_REQUIRED"] = "1"
        environ["TMPDIR"] = "/var/lib/sac-builder/tmp"
    proc = subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, start_new_session=True, env=environ,
    )
    try:
        stdout, _ = proc.communicate(input=json.dumps(job), timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        return _result(job, "infra-error", "audit-timeout")
    if proc.returncode != 0 or len(stdout) > MAX_REPORT:
        return _result(job, "infra-error", "audit-runtime-error")
    rows = [r for r in stdout.splitlines() if r.startswith("SAC_AUDIT_RESULT ")]
    if len(rows) != 1:
        return _result(job, "infra-error", "audit-report-missing")
    try:
        return _normalize(job, json.loads(rows[0][len("SAC_AUDIT_RESULT "):]))
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return _result(job, "infra-error", "audit-report-invalid")


def execute_received(state_dir, policy, registry, *, limit=1, executor="/usr/bin/node", timeout=150,
                     invoke=None, enable_build=False, docker_host=None):
    """Process only accepted inbox requests, serially and without replaying results.

    Caller holds the same exclusive worker.lock as vps_daemon. No backend actions,
    git checkout, compilation, or service modification happen in this function.
    """
    if docker_host is not None and (type(docker_host) is not str or
            re.fullmatch(r"unix:///run/user/[1-9][0-9]{0,9}/docker\.sock", docker_host) is None):
        raise ValueError("invalid-rootless-docker-host")
    if type(enable_build) is not bool:
        raise ValueError("invalid-build-toggle")
    if type(limit) is not int or not 1 <= limit <= 4:
        raise ValueError("invalid-execution-limit")
    if not Path(executor).is_absolute():
        raise ValueError("executor-must-be-absolute")
    permitted = sac_job_queue.validate_policy(policy)
    manifests = load_registry(registry)
    state = Path(state_dir)
    jobs = state / "sac-jobs"
    if not jobs.exists():
        return {"processed": 0, "skipped": 0, "execution": "audit-only"}
    sac_job_queue._directory(jobs)
    results = state / "sac-results"
    results.mkdir(parents=True, exist_ok=True)
    sac_job_queue._directory(results)
    processed = skipped = 0
    for name in sorted(f.name for f in jobs.iterdir() if f.name.startswith("gha-")):
        if processed >= limit:
            break
        if not name.endswith(".json") or not sac_job_queue.JOB_ID.fullmatch(name[:-5]):
            skipped += 1
            continue
        if (results / name).exists() or (results / name).is_symlink():
            skipped += 1
            continue
        try:
            receipt = sac_job_queue._read(jobs / name)
            if (type(receipt) is not dict or receipt.get("schema_version") != 1
                    or receipt.get("job_id") + ".json" != name
                    or receipt.get("status") != "received"
                    or receipt.get("execution") != "disabled"
                    or receipt.get("deployment_authorized") is not False):
                raise ValueError("invalid-job-receipt")
            job = sac_job_queue.validate_request(sac_job_queue._read(state / "sac-inbox" / name))
            if not all(receipt[k] == job[k] for k in ("job_id", "project_id", "profile_id", "source_sha")):
                raise ValueError("inbox-receipt-mismatch")
            pair = (job["project_id"], job["profile_id"])
            if pair not in permitted or pair not in manifests:
                raise ValueError("project-not-authorized")
            manifest = manifests[pair]
            try:
                outcome = (invoke or _invoke)(job, manifest, executor=executor, timeout=timeout, enable_build=enable_build, docker_host=docker_host)
                result = _normalize(job, outcome)
            except (OSError, ValueError, TypeError, KeyError):
                result = _result(job, "infra-error", "audit-runner-error")
            sac_job_queue._create_once(results, name, result)
            processed += 1
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            skipped += 1
    return {"processed": processed, "skipped": skipped, "execution": "audit-only"}
