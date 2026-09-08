#!/usr/bin/env python3
"""Install only the existing watchdog implementation; never restart a unit."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parent.parent
home = Path("/home/earch")
destination = home / ".local/lib/imnova-seller-os-watchdog"
launcher = home / ".local/bin/imnova-seller-os-watchdog"
state_dir = home / ".local/state/imnova-seller-os"
artifacts = home / "seller-os-isolated-audits/watchdog-fix-20260908"

deadline = time.monotonic() + 50
while True:
    busy = []
    for unit in ("imnova-seller-os-watchdog.service", "imnova-seller-os-runtime-health-reporter.service"):
        state = subprocess.check_output(["/usr/bin/systemctl", "--user", "show", unit,
                                         "--property=ActiveState", "--value"], timeout=5, text=True).strip()
        if state not in ("inactive", "failed"):
            busy.append(unit)
    if not busy:
        break
    if time.monotonic() >= deadline:
        raise SystemExit("INSTALLATION_REQUIRES_IDLE: " + ",".join(busy))
    time.sleep(min(2, max(0, deadline - time.monotonic())))

state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
lock_fd = os.open(state_dir / "watchdog.lock", os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("INSTALLATION_REQUIRES_IDLE_WATCHDOG_TRANSACTION")

artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
backup = artifacts / "watchdog-before-install"
if not backup.exists():
    backup.write_bytes(launcher.read_bytes())
    backup.chmod(0o600)

def install(source, target, mode):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = target.with_name(target.name + ".installing")
    with temporary.open("wb") as stream:
        stream.write(source.read_bytes())
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(mode)
    temporary.replace(target)
    return {"path": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}

files = ["lib/ebay/ebay-seller-os-controlled-restart-settle-v1.ts",
         "lib/ebay/ebay-seller-os-watchdog-recovery-v1.mjs",
         "tools/seller-os-watchdog-v1.mjs"]
installed = [install(root / path, destination / path, 0o600) for path in files]
# Swap the entrypoint last so no timer can invoke an incomplete implementation.
installed.append(install(root / "tools/imnova-seller-os-watchdog", launcher, 0o700))
receipt = {"installedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "files": installed, "unitFilesChanged": 0, "serviceRestarts": 0,
           "relayChanged": False, "timerScheduleChanged": False}
(artifacts / "installation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
