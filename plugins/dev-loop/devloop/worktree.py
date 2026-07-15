from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MergeResult:
    ok: bool
    conflict: bool
    output: str


def _git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True,
    )


def add_worktree(repo, path, branch, base) -> None:
    r = _git(repo, "worktree", "add", "-b", branch, str(path), base)
    if r.returncode != 0:
        raise RuntimeError("worktree add failed: %s" % (r.stderr or r.stdout))


def merge_branch(repo, branch) -> "MergeResult":
    r = _git(repo, "merge", "--no-ff", "-m", "merge %s" % branch, branch)
    if r.returncode == 0:
        return MergeResult(ok=True, conflict=False, output=r.stdout)
    _git(repo, "merge", "--abort")
    return MergeResult(ok=False, conflict=True, output=r.stdout + r.stderr)


def remove_worktree(repo, path, branch) -> None:
    _git(repo, "worktree", "remove", "--force", str(path))
    _git(repo, "branch", "-D", branch)


def list_worktree_paths(repo) -> list:
    r = _git(repo, "worktree", "list", "--porcelain")
    main = str(Path(repo).resolve())
    paths = []
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            p = str(Path(line[len("worktree "):]).resolve())
            if p != main:
                paths.append(p)
    return paths


def worktree_exists(repo, path) -> bool:
    return str(Path(path).resolve()) in list_worktree_paths(repo)
