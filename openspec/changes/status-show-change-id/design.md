## Context

`_cmd_status` 目前以 `print("phase=%s iteration=%d" % (cp.phase, cp.iteration))` 輸出。`Checkpoint` 已含 `change_id` 與 `branch` 欄位,只是未呈現。

## Goals / Non-Goals

**Goals:**
- status 單行輸出包含 change_id 與 branch。
- 不破壞既有測試與既有欄位順序。

**Non-Goals:**
- 不引入 `--json` 輸出格式(YAGNI)。
- 不更動其他子命令。

## Decisions

- 在現有字串尾端追加 `change_id=%s branch=%s`,保留前段不變以維持向後相容與可被既有斷言比對。

## Risks / Trade-offs

- 風險極低;純輸出格式追加。下游若以嚴格全字串比對解析 status 需更新,但目前無此消費者。
