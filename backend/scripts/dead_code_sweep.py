#!/usr/bin/env python3
"""
dead_code_sweep.py — Quét file mồ côi (0-importer) cho Song Châu ERP.

MỤC ĐÍCH
--------
Liệt kê các file backend (.py) và frontend (.ts/.tsx) KHÔNG được import/tham
chiếu ở đâu trong repo, để con người xác nhận rồi xoá tay (script này KHÔNG
tự xoá bất cứ file nào — chỉ đọc và báo cáo).

PHẠM VI (đọc kỹ trước khi dùng)
--------------------------------
- Backend: mọi *.py dưới backend/app/**, TRỪ:
    * __init__.py (marker package, không phải "module chức năng")
    * entrypoint: backend/app/main.py, backend/run_worker.py
    * file được mount (import) trực tiếp trong
      backend/app/api/v1/__init__.py hoặc backend/app/api/vendor/__init__.py
      — các router này LUÔN có ≥1 importer (chính file __init__ đó), việc
      hàm bên trong có endpoint nào 0-caller-nội-bộ hay không là phạm vi
      của W2-12 (router-mounted-0-caller), KHÔNG phải script này.
- Frontend: mọi *.ts/*.tsx dưới frontend/src/** và vendor-portal/src/**,
  TRỪ file quy ước Next.js App Router (page.tsx, layout.tsx, route.ts,
  loading.tsx, error.tsx, not-found.tsx, template.tsx, default.tsx,
  global-error.tsx, middleware.ts) — các file này là entrypoint theo
  file-system routing, không cần ai "import" chúng. Việc trang mồ côi
  (route không còn ai link tới) là phạm vi của W2-13, KHÔNG phải script
  này. Cũng loại trừ *.d.ts, *.test.ts(x), *.spec.ts(x), *.stories.tsx.

CÁCH QUÉT — 2 LỚP
------------------
Lớp 1 (import-shaped): tìm cú pháp import thật sự.
  - Python: `import app.a.b.mod`, `from app.a.b import mod`,
    `from app.a.b.mod import X`, `from . import mod`, `from .mod import X`
    (số dấu chấm bất kỳ cho relative import).
  - TS/TSX: `import ... from '<spec>'`, `export ... from '<spec>'`,
    `require('<spec>')`, `import('<spec>')` — so khớp segment cuối của
    <spec> (bỏ đuôi mở rộng) với stem của file ứng viên. Bắt được cả
    alias '@/...' lẫn relative './...'/'../...'.

Lớp 2 (raw-string / dynamic): file có thể được nạp gián tiếp (importlib,
  bảng route động, lazy-map theo tên chuỗi...). Lớp này tìm CHUỖI khớp
  đúng tên stem xuất hiện trong dấu nháy ('...'/"..."/`...`) ở bất kỳ vị
  trí nào KHÔNG thuộc câu import đã đếm ở Lớp 1.

Một file được coi là "mồ côi" (orphan) nếu KHÔNG có bất kỳ tham chiếu nào
ở CẢ hai lớp, xét trên toàn bộ vùng quét tương ứng (backend/ cho python;
frontend/src hoặc vendor-portal/src cho ts, theo đúng cây của nó — hai
project không tham chiếu chéo qua alias '@/').

ĐÂY LÀ HEURISTIC DỰA TRÊN REGEX, KHÔNG PHẢI TRÌNH PHÂN GIẢI AST ĐẦY ĐỦ.
Có thể có false positive (vd file chỉ dùng qua barrel export phức tạp,
hoặc dynamic import kiểu path-template) và false negative (chuỗi trùng
tên tình cờ). LUÔN xác nhận bằng mắt trước khi xoá — dùng allowlist bên
dưới để ghi nhận các trường hợp đã xác nhận là "an toàn / cố ý giữ".

CÁCH CHẠY
---------
    cd backend
    python scripts/dead_code_sweep.py
    python scripts/dead_code_sweep.py --root ..            # chỉ định gốc repo khác
    python scripts/dead_code_sweep.py --json                # in JSON thay vì bảng text

Exit code:
    0  — không có finding nào ngoài allowlist (sạch)
    1  — có ≥1 finding ngoài allowlist (in danh sách kèm bằng chứng)

CÁCH THÊM ALLOWLIST
--------------------
Sửa file scripts/dead_code_allowlist.yaml (cạnh script này). Mỗi entry:

    - path: backend/app/etl/bqms_sitemap.py
      reason: >
        W0-16 sẽ xoá cùng đợt (Fable phán keep sai — 2 "caller" chỉ là
        comment nhắc file .md). Allowlist TẠM để script không đỏ trong
        lúc chờ xoá; gỡ entry này ngay sau khi file bị xoá thật.

`reason` là BẮT BUỘC (script tự kiểm tra, thiếu reason → lỗi khi load
allowlist, không lặng lẽ bỏ qua). Path ghi tương đối so với root repo
(dùng dấu / , không dùng dấu gạch chéo ngược).

TỰ CHỨNG MINH (self-test)
--------------------------
    python scripts/dead_code_sweep.py --self-test

Tạo 1 file .py orphan giả trong thư mục tạm, quét cô lập, xác nhận
script phát hiện đúng (exit 1) rồi tự xoá file tạm. Không đụng gì tới
repo thật.
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
import tempfile
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    import yaml
except ImportError:  # pragma: no cover
    print("Cần PyYAML: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

# Windows console mặc định dùng cp1252 -> vỡ khi print tiếng Việt có dấu.
# Ép UTF-8 cho stdout/stderr nếu runtime hỗ trợ (Python 3.7+).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # pragma: no cover
            pass


# ─────────────────────────── Cấu hình phạm vi ───────────────────────────

BACKEND_APP_SUBDIR = Path("backend/app")
BACKEND_HAYSTACK_ROOTS = [Path("backend")]  # nơi tìm tham chiếu (rộng hơn candidate)
BACKEND_HAYSTACK_EXCLUDE_DIRS = {"__pycache__", "node_modules", ".git", "alembic/versions"}

BACKEND_EXCLUDE_FILES = {
    Path("backend/app/main.py"),
    Path("backend/run_worker.py"),
}
BACKEND_EXCLUDE_NAMES = {"__init__.py"}

# file mà nếu bị import trực tiếp trong các router-registry này thì loại
# khỏi candidate list (xem docstring — phạm vi W2-12, không phải ở đây)
BACKEND_ROUTER_REGISTRIES = [
    Path("backend/app/api/v1/__init__.py"),
    Path("backend/app/api/vendor/__init__.py"),
]

FRONTEND_ROOTS = [Path("frontend/src"), Path("vendor-portal/src")]
FRONTEND_EXCLUDE_DIRS = {"node_modules", ".next", "dist", "build", "__pycache__"}

NEXTJS_SPECIAL_FILENAMES = {
    "page.tsx", "page.ts",
    "layout.tsx", "layout.ts",
    "route.ts", "route.tsx",
    "loading.tsx", "error.tsx", "not-found.tsx",
    "template.tsx", "default.tsx", "global-error.tsx",
    "middleware.ts",
}
FRONTEND_EXCLUDE_SUFFIXES = (".d.ts",)
FRONTEND_EXCLUDE_STEM_SUFFIXES = (".test", ".spec", ".stories")


@dataclass
class Finding:
    rel_path: str          # posix, tương đối repo root
    kind: str               # "backend" | "frontend"
    stem: str
    evidence: str            # lý do cụ thể (đã quét bao nhiêu file, 2 lớp)


@dataclass
class AllowlistEntry:
    path: str
    reason: str


# ─────────────────────────── Helpers dùng chung ───────────────────────────

def _iter_files(root: Path, exts: tuple[str, ...], exclude_dirs: set[str]) -> Iterable[Path]:
    if not root.exists():
        return
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in exts:
            continue
        if any(part in exclude_dirs for part in p.parts):
            continue
        yield p


def _read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


# ─────────────────────────── Backend (Python) ───────────────────────────

PY_IMPORT_MODULE_RE = re.compile(r"^\s*import\s+([\w\.]+)(?:\s+as\s+\w+)?\s*$", re.M)
PY_FROM_IMPORT_RE = re.compile(
    r"^\s*from\s+(?P<mod>[\.\w]+)\s+import\s+(?P<names>.+)$", re.M
)


def _py_module_dotted(app_root: Path, py_file: Path) -> str:
    """backend/app/etl/bqms_sitemap.py -> app.etl.bqms_sitemap"""
    rel = py_file.relative_to(app_root.parent)  # relative to 'backend/'
    parts = list(rel.with_suffix("").parts)
    return ".".join(parts)


def _py_router_mounted_modules(root: Path) -> set[str]:
    """Module dotted-path của mọi file được import trong các router registry."""
    mounted: set[str] = set()
    for registry in BACKEND_ROUTER_REGISTRIES:
        full = root / registry
        text = _read_text(full)
        if not text:
            continue
        for m in PY_IMPORT_MODULE_RE.finditer(text):
            mounted.add(m.group(1))
        for m in PY_FROM_IMPORT_RE.finditer(text):
            mod = m.group("mod")
            if mod.startswith("."):
                continue  # registry files dùng absolute import (app.xxx) trong repo này
            names = m.group("names")
            for name in re.findall(r"\b(\w+)\b", names):
                if name in ("import", "as"):
                    continue
                mounted.add(f"{mod}.{name}")
    return mounted


def _py_candidates(root: Path) -> list[tuple[Path, str, str]]:
    """Trả về list (path_tuyet_doi, rel_posix, dotted_module) ứng viên."""
    app_root = root / BACKEND_APP_SUBDIR
    mounted = _py_router_mounted_modules(root)
    out = []
    for f in _iter_files(app_root, (".py",), BACKEND_HAYSTACK_EXCLUDE_DIRS):
        rel = f.relative_to(root)
        if rel in BACKEND_EXCLUDE_FILES:
            continue
        if f.name in BACKEND_EXCLUDE_NAMES:
            continue
        dotted = _py_module_dotted(app_root, f)
        if dotted in mounted:
            continue
        out.append((f, rel.as_posix(), dotted))
    return out


def _py_haystack_files(root: Path, exclude_self: Path) -> list[Path]:
    files = []
    for hroot in BACKEND_HAYSTACK_ROOTS:
        for f in _iter_files(root / hroot, (".py",), BACKEND_HAYSTACK_EXCLUDE_DIRS):
            if f == exclude_self:
                continue
            files.append(f)
    return files


def _py_reference_check(root: Path, py_file: Path, dotted: str) -> tuple[bool, bool]:
    """Trả (has_import_shaped, has_raw_string) tham chiếu tới module `dotted`."""
    stem = py_file.stem
    parent_mod = ".".join(dotted.split(".")[:-1])

    import_patterns = [
        re.compile(r"^\s*import\s+" + re.escape(dotted) + r"\b", re.M),
        re.compile(r"^\s*from\s+" + re.escape(dotted) + r"\s+import\b", re.M),
        re.compile(
            r"^\s*from\s+" + re.escape(parent_mod) + r"\s+import\s+.*\b"
            + re.escape(stem) + r"\b",
            re.M,
        ),
        re.compile(r"^\s*from\s+\.+\w*\s+import\s+.*\b" + re.escape(stem) + r"\b", re.M),
        re.compile(r"^\s*from\s+\.+" + re.escape(stem) + r"\s+import\b", re.M),
    ]
    raw_string_pattern = re.compile(r"""['"]""" + re.escape(stem) + r"""['"]""")

    has_import = False
    has_raw = False
    for f in _py_haystack_files(root, exclude_self=py_file):
        text = _read_text(f)
        if not text:
            continue
        if not has_import and any(p.search(text) for p in import_patterns):
            has_import = True
        if not has_raw:
            for m in raw_string_pattern.finditer(text):
                line_start = text.rfind("\n", 0, m.start()) + 1
                line_end = text.find("\n", m.end())
                line = text[line_start: line_end if line_end != -1 else None]
                if "import" not in line:  # tránh đếm trùng cái đã tính ở lớp 1
                    has_raw = True
                    break
        if has_import and has_raw:
            break
    return has_import, has_raw


def scan_backend(root: Path) -> list[Finding]:
    findings = []
    for f, rel, dotted in _py_candidates(root):
        has_import, has_raw = _py_reference_check(root, f, dotted)
        if not has_import and not has_raw:
            findings.append(
                Finding(
                    rel_path=rel,
                    kind="backend",
                    stem=f.stem,
                    evidence=(
                        f"0 import-shaped + 0 raw-string reference tới "
                        f"module '{dotted}' trong backend/"
                    ),
                )
            )
    return findings


# ─────────────────────────── Frontend (TS/TSX) ───────────────────────────

TS_SPEC_RE = re.compile(
    r"""(?:
        \bimport\s+(?:[^'"();]*?\bfrom\s+)?['"](?P<spec1>[^'"]+)['"]
      | \bexport\s+(?:[^'"();]*?\bfrom\s+)?['"](?P<spec2>[^'"]+)['"]
      | \brequire\(\s*['"](?P<spec3>[^'"]+)['"]\s*\)
      | \bimport\(\s*['"](?P<spec4>[^'"]+)['"]\s*\)
    )""",
    re.X,
)


def _frontend_excluded(rel: Path) -> bool:
    if rel.name in NEXTJS_SPECIAL_FILENAMES:
        return True
    if rel.suffix and str(rel).endswith(FRONTEND_EXCLUDE_SUFFIXES):
        return True
    stem = rel.stem
    if any(stem.endswith(suf) for suf in FRONTEND_EXCLUDE_STEM_SUFFIXES):
        return True
    return False


def _frontend_candidates(fe_root_abs: Path) -> list[tuple[Path, Path]]:
    out = []
    for f in _iter_files(fe_root_abs, (".ts", ".tsx"), FRONTEND_EXCLUDE_DIRS):
        rel = f.relative_to(fe_root_abs)
        if _frontend_excluded(rel):
            continue
        out.append((f, rel))
    return out


def _ts_reference_check(fe_root_abs: Path, ts_file: Path) -> tuple[bool, bool]:
    stem = ts_file.stem
    has_import = False
    has_raw = False
    for f in _iter_files(fe_root_abs, (".ts", ".tsx"), FRONTEND_EXCLUDE_DIRS):
        if f == ts_file:
            continue
        text = _read_text(f)
        if not text:
            continue
        import_line_spans: list[tuple[int, int]] = []
        if not has_import:
            for m in TS_SPEC_RE.finditer(text):
                spec = m.group("spec1") or m.group("spec2") or m.group("spec3") or m.group("spec4")
                if not spec:
                    continue
                last_seg = spec.rstrip("/").split("/")[-1]
                if last_seg == stem or last_seg == f"{stem}.tsx" or last_seg == f"{stem}.ts":
                    has_import = True
                import_line_spans.append(m.span())
        if not has_raw:
            for m in re.finditer(r"""['"`]""" + re.escape(stem) + r"""['"`]""", text):
                inside_import = any(a <= m.start() <= b for a, b in import_line_spans)
                if not inside_import:
                    has_raw = True
                    break
        if has_import and has_raw:
            break
    return has_import, has_raw


def scan_frontend(root: Path) -> list[Finding]:
    findings = []
    for fe_rel_root in FRONTEND_ROOTS:
        fe_root_abs = root / fe_rel_root
        if not fe_root_abs.exists():
            continue
        for f, rel in _frontend_candidates(fe_root_abs):
            has_import, has_raw = _ts_reference_check(fe_root_abs, f)
            if not has_import and not has_raw:
                full_rel = (fe_rel_root / rel).as_posix()
                findings.append(
                    Finding(
                        rel_path=full_rel,
                        kind="frontend",
                        stem=f.stem,
                        evidence=(
                            f"0 import-shaped + 0 raw-string reference tới "
                            f"'{f.stem}' trong {fe_rel_root.as_posix()}/"
                        ),
                    )
                )
    return findings


# ─────────────────────────── Allowlist ───────────────────────────

def load_allowlist(script_dir: Path) -> dict[str, AllowlistEntry]:
    path = script_dir / "dead_code_allowlist.yaml"
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    if not isinstance(data, list):
        raise ValueError(f"{path}: root phải là YAML list")
    out: dict[str, AllowlistEntry] = {}
    for i, entry in enumerate(data):
        if not isinstance(entry, dict) or "path" not in entry:
            raise ValueError(f"{path}: entry #{i} thiếu field 'path'")
        reason = entry.get("reason")
        if not reason or not str(reason).strip():
            raise ValueError(
                f"{path}: entry '{entry.get('path')}' THIẾU field 'reason' bắt buộc"
            )
        p = str(entry["path"]).replace("\\", "/")
        out[p] = AllowlistEntry(path=p, reason=str(reason).strip())
    return out


# ─────────────────────────── CLI / main ───────────────────────────

def _self_test() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="dead_code_sweep_selftest_"))
    try:
        app_dir = tmp / "backend" / "app" / "etl"
        app_dir.mkdir(parents=True)
        (tmp / "backend" / "app" / "__init__.py").parent.mkdir(parents=True, exist_ok=True)
        (tmp / "backend" / "app" / "__init__.py").write_text("", encoding="utf-8")
        (tmp / "backend" / "app" / "etl" / "__init__.py").write_text("", encoding="utf-8")
        orphan = app_dir / "totally_orphan_module_xyz.py"
        orphan.write_text("def never_called():\n    return 1\n", encoding="utf-8")
        # đăng ký registry rỗng để _py_router_mounted_modules không lỗi
        (tmp / "backend" / "app" / "api").mkdir(parents=True, exist_ok=True)
        (tmp / "backend" / "app" / "api" / "v1").mkdir(parents=True, exist_ok=True)
        (tmp / "backend" / "app" / "api" / "v1" / "__init__.py").write_text("", encoding="utf-8")

        findings = scan_backend(tmp)
        names = {f.rel_path for f in findings}
        expected = "backend/app/etl/totally_orphan_module_xyz.py"
        if expected in names:
            print(f"[self-test] PASS — phát hiện đúng orphan giả: {expected}")
            return 0
        else:
            print(f"[self-test] FAIL — KHÔNG phát hiện orphan giả. Findings: {names}")
            return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=None, help="Root repo (mặc định: 2 cấp trên script này)")
    parser.add_argument("--json", action="store_true", help="In JSON thay vì bảng text")
    parser.add_argument("--self-test", action="store_true", help="Chạy self-test với file orphan giả rồi thoát")
    args = parser.parse_args()

    if args.self_test:
        return _self_test()

    script_dir = Path(__file__).resolve().parent
    root = Path(args.root).resolve() if args.root else script_dir.parent.parent

    allowlist = load_allowlist(script_dir)

    findings = scan_backend(root) + scan_frontend(root)
    unallowed = [f for f in findings if f.rel_path not in allowlist]
    allowed = [f for f in findings if f.rel_path in allowlist]

    if args.json:
        import json
        print(json.dumps(
            {
                "unallowed": [f.__dict__ for f in unallowed],
                "allowlisted": [
                    {**f.__dict__, "reason": allowlist[f.rel_path].reason} for f in allowed
                ],
            },
            ensure_ascii=False, indent=2,
        ))
    else:
        print(f"== dead_code_sweep.py — quét {root} ==")
        print(f"Tổng ứng viên orphan: {len(findings)}  |  Allowlist: {len(allowed)}  |  Ngoài allowlist: {len(unallowed)}\n")
        if allowed:
            print("-- Đã allowlist (bỏ qua, có lý do) --")
            for f in allowed:
                print(f"  [{f.kind}] {f.rel_path}")
                print(f"      lý do allowlist: {allowlist[f.rel_path].reason}")
            print()
        if unallowed:
            print("-- NGOÀI allowlist — cần xác nhận tay trước khi xoá --")
            for f in unallowed:
                print(f"  [{f.kind}] {f.rel_path}")
                print(f"      bằng chứng: {f.evidence}")
        else:
            print("Sạch — không có finding nào ngoài allowlist.")

    return 1 if unallowed else 0


if __name__ == "__main__":
    sys.exit(main())
