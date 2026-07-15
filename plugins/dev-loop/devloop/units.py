from __future__ import annotations

_PENDING = ("pending", "in_progress")


def build_units(parallel_groups, branch, wt_root):
    units = []
    for g in parallel_groups:
        gid = g["id"]
        units.append({
            "id": gid,
            "tasks": g.get("tasks", []),
            "worktree": "%s/%s" % (wt_root, gid),
            "branch": "%s-%s" % (branch, gid),
            "status": "pending",
        })
    return units


def pending_units(units):
    return [u for u in units if u["status"] in _PENDING]


def mark(units, unit_id, status):
    for u in units:
        if u["id"] == unit_id:
            u["status"] = status
            return
    raise KeyError("no unit %r" % unit_id)


def all_done(units):
    return bool(units) and all(u["status"] in ("done", "merged") for u in units)


def all_merged(units):
    return bool(units) and all(u["status"] == "merged" for u in units)
