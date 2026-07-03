"""SFTP push enrich_pim_rfq.py + PIM workbook lên VPS.

Sequence:
  1. Connect SSH via paramiko (uses env VPS_HOST / VPS_USER / VPS_KEY)
  2. mkdir -p /srv/sc-erp/data/pim/  /srv/sc-erp/scripts/
  3. SFTP put script (ASCII path on VPS)
  4. SFTP put workbook (rename to ASCII filename)
  5. Inside sc-api container: chmod, verify openpyxl can open
  6. Print suggested commands for dry-run + apply

Env vars expected:
  VPS_HOST          (e.g. new vps ip)
  VPS_USER          (default: root)
  VPS_KEY           (private key path, default: ~/.ssh/id_rsa)
  VPS_DEPLOY_ROOT   (default: /srv/sc-erp)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

LOCAL_SCRIPT = Path(__file__).with_name("enrich_pim_rfq.py")
LOCAL_PIM_DEFAULT = Path(
    "C:/Users/ASUS/OneDrive - SONG CHAU CO., LTD/Puplic/PIM/"
    "PIM of Thong ke hoi hang - update 240424.xlsm"
)
REMOTE_PIM_NAME = "PIM-of-Thong-ke-hoi-hang-update-240424.xlsm"


def main() -> int:
    host = os.environ.get("VPS_HOST")
    if not host:
        print("ERROR: VPS_HOST not set", file=sys.stderr)
        return 2
    user = os.environ.get("VPS_USER", "root")
    key_path = Path(os.environ.get("VPS_KEY", "~/.ssh/id_rsa")).expanduser()
    deploy_root = os.environ.get("VPS_DEPLOY_ROOT", "/srv/sc-erp")

    local_pim = Path(os.environ.get("LOCAL_PIM_PATH", str(LOCAL_PIM_DEFAULT)))
    if not local_pim.exists():
        print(f"ERROR: PIM workbook not found at {local_pim}", file=sys.stderr)
        return 2
    if not LOCAL_SCRIPT.exists():
        print(f"ERROR: Script not found at {LOCAL_SCRIPT}", file=sys.stderr)
        return 2

    print(f"Connecting {user}@{host} (key={key_path})…")
    pkey = paramiko.RSAKey.from_private_key_file(str(key_path))
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, pkey=pkey, timeout=30)

    try:
        for d in (f"{deploy_root}/scripts", f"{deploy_root}/data/pim"):
            ssh.exec_command(f"mkdir -p {d}")
        sftp = ssh.open_sftp()
        try:
            remote_script = f"{deploy_root}/scripts/enrich_pim_rfq.py"
            remote_pim = f"{deploy_root}/data/pim/{REMOTE_PIM_NAME}"

            print(f"Uploading script → {remote_script}")
            sftp.put(str(LOCAL_SCRIPT), remote_script)
            sftp.chmod(remote_script, 0o755)

            print(f"Uploading PIM workbook → {remote_pim}")
            sftp.put(str(local_pim), remote_pim)
        finally:
            sftp.close()

        print("\nSuggested commands on VPS:")
        print(
            f"  docker cp {deploy_root}/scripts/enrich_pim_rfq.py "
            f"sc-api:/app/scripts/enrich_pim_rfq.py"
        )
        print(
            f"  docker exec sc-api python /app/scripts/enrich_pim_rfq.py "
            f"--source /data/pim/{REMOTE_PIM_NAME} --dry-run --verbose"
        )
        print(
            f"  # If dry-run looks good, drop --dry-run to apply."
        )
    finally:
        ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
