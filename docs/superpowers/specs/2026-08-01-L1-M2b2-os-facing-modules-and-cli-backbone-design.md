# L1 M2b-2 設計:碰 OS 的模組 + CLI backbone

日期:2026-08-01
狀態:待實作(L1 TS 重寫,接在 M2b-1 之後)

## 背景

L1 TS 重寫採雙軌。M1 移植 checkpoint/statemachine,M2a 移植六個純模組並解決交付阻斷點,parity fixtures 把跨引擎一致性變成可執行斷言,M2b-1 移植 units/review/housekeeping 並把 `bin/devloop` 交給 TS 當前門(TS 認得的自己處理,其餘委派回 `python3 -m devloop.cli`)。

M2b-1 發現的閘門:**每一個會改 checkpoint 的子命令都走 `_save_with_history` → `watcher._ensure_armed_after_save` → `ensure_armed` → spawn detached 行程。** 所以 19 個變更型命令一個都接不上,直到 watcher 移植完成。本 spec 拆掉這道閘門。

## 樞紐決策:TS 的 `ensureArmed` spawn node

Python 現行是 spawn 自己:

```python
argv = [sys.executable, "-m", "devloop.cli", "watch", "--exec", shlex.join(exec_command), ...]
proc = subprocess.Popen(argv, start_new_session=True, env=env)
```

**watcher 行程本身就是引擎。** 它 spawn 一個 detached 的自己跑 `watch` 子命令,那個迴圈可能活好幾小時,週期性重跑 `resume_exec`(典型值 `claude -p '/dev-loop resume'`)直到 loop 被推進。

**裁決:TS 的 `ensureArmed` spawn `node dist/cli.js watch`。** 連帶必須移植 `adapter` 的 `runWatcher` 迴圈與 `watch` 子命令——那是被 spawn 的東西,不能只移植一半。

理由:M2c 刪掉 Python 時,一個 spawn `python3` 的 watcher 就沒了。選 python3 保證要重做一次。

**混合狀態是安全的**:`watcher.pid` 是兩引擎共用的單一檔,而 `ensureArmed` 是 idempotent——看到 pid 還活著就不重 spawn。所以「舊的 Python watcher 還在跑、新命令由 TS 執行」不會產生兩個 watcher。

## 範圍

**模組五個**:`gate`(38 行)、`worktree`(54)、`adapter`(69)、`teardown`(86)、`watcher`(117)。

**CLI backbone**:`_apply_event`(transition 後寫回 phase/iteration)與 `_save_with_history`(save → history 追加 → auto-arm)。這是 19 個變更型命令共用的東西,一落地,M2c 剩下的多半是套版。

**命令六個**:
- `watch` —— 被 spawn 的那個,必須
- `arm-local`、`watcher-status` —— watcher 生命週期的另外兩面
- `status` —— **補完還債**。M2b-1 把它從 `TS_COMMANDS` 拿掉了,因為它缺三樣東西:`gate_cmds` 沒從 config 讀(導致 `next:` hint 與 Python 不同)、`--json` 被靜默忽略、watcher 未執行的警告消失。第三項需要 watcher 模組,這輪才有
- `event` —— 通用狀態機驅動,跑 backbone 的主要路徑;含 `qa_skip` guard(僅 `flow_profile=light` 且非 uiux 放行)
- `gate` —— 用 gate 模組;注意它的 exit code 是三分岔:0 通過、1 轉 fix、**3 escalated**

## 三個必須自己發明的接縫

Python 這五個模組用了三樣 Node 沒有對應物的東西,每一樣都是移植的斷層線。

### 1. `shlex` —— 本輪最高風險

```python
shlex.join(exec_command)   # watcher spawn 時
shlex.split(args.exec)     # watch 命令收到後
shlex.split(c)             # gate 把每條 gate_cmds 切成 argv
```

`resume_exec` 的典型值是 `claude -p '/dev-loop resume'`。它要被 split 成 argv、join 回字串、再 split 一次。Node 沒有 shlex,得自己寫 POSIX 相容的 split/join。

**寫歪的後果是續跑命令被切錯,而 watcher 是無人看管的背景行程**——它每次重試都跑一個錯的命令,輸出只進 `watcher-log.jsonl`,沒有人會當場發現。`gate` 那條也一樣:切錯的 gate 命令會變成「gate 失敗」,把 loop 推去 fix 而不是報告工具問題。

自己的 fixture,逐字元等級。

### 2. `Path.resolve()` 的語意

`worktree.list_worktree_paths` 與 `teardown.prune_orphan_worktrees` 都靠它比對路徑。Python 的 `.resolve()` **會解 symlink,而且路徑不存在也不拋錯**(3.6+ 預設 `strict=False`)。Node 這邊 `resolve()` 不解 symlink、`realpathSync()` 解但路徑不存在就拋。

macOS 的 `/tmp` 是 `/private/tmp` 的 symlink——測試就跑在那裡。搞錯的話 `worktree_exists` 永遠回 false、`prune_orphan_worktrees` 的前綴比對永遠不成立,而它是**靜默無作為**不是崩潰:孤兒 worktree 永遠不會被清掉,沒有任何錯誤訊息。

這是 `pyGet`/`pyTruthy`/`pyIndex` 之後的第四個 Python 語意 helper,放進 `jsonio.ts` 的同一族(或視實作時的檔案大小另立 `pypath.ts`)。

### 3. detached spawn 與 signal

- `Popen(argv, start_new_session=True, env=env)` → `spawn(cmd, args, { detached: true, stdio: "ignore", env })` + `unref()`
- `os.kill(pid, 0)` 探活 → `process.kill(pid, 0)`;兩邊都靠 ESRCH(無此行程 → 死)/ EPERM(存在但屬他人 → 活)區分,這個分類必須照抄
- `os.kill(pid, signal.SIGTERM)` → `process.kill(pid, "SIGTERM")`

## 測試策略

### parity fixture 五個新對象

都是「給定注入的接縫後就是純函式」的部分:

| fixture | 釘什麼 |
|---|---|
| `shlex.json` | split / join / 往返。含 `claude -p '/dev-loop resume'`、巢狀引號、反斜線、空字串、含換行、非 ASCII |
| `gate.json` | 注入 runner 的 exit code 序列 → `GateResult`(短路在第幾條、`failed_command`、output 併法、timeout 分支) |
| `adapter.json` | 注入 sleep/run 的序列 → 回傳值 + 每次追加的 log 條目(`exit_code`/`output_tail`/`action`/`heartbeat`) |
| `worktree.json` | `git worktree list --porcelain` 的 canned stdout → 路徑清單。`Path.resolve` 的斷層線在這 |
| `teardown.json` | `delete_merged_branch` 把 git stderr 分類成 `deleted`/`checked_out`/`unmerged`/`absent`。canned stderr 進、字串出 |

後兩個特別值得做:它們把「解析外部工具的輸出」變成純函式,而那正是兩個引擎最容易各自解讀出不同結果的地方。

**`adapter.json` 的時間戳**:log 條目含 `ts`,兩引擎文法不同(既有延後項)。比照 checkpoint round trip 的做法——不列入 `expect`,改斷言共通前綴。

### 跨引擎矩陣擴到六個新命令

沿用 M2b-1 建立的 `crossEngine.test.ts`(迭代 `TS_COMMANDS`,缺矩陣列即紅)。三個命令的輸出含易變欄位:

```
watcher armed (pid=41287)               ← arm-local
last attempt: 2026-08-01T07:35:03...    ← watcher-status
updated_at=2026-08-01T04:48:48.845976   ← status
```

**歸一化易變欄位**:比對前把 `pid=\d+` 與 ISO 時間戳換成佔位符,每個 case 自己宣告要歸一化什麼。真的進不了矩陣的命令列進豁免名單,**且必須寫理由**——沒人能靜默逃掉。

`watch` 進得了矩陣:實測 `watch --exec /usr/bin/true --heartbeat 1` 立刻回 0 並寫一行 log。`arm-local` 同樣用會立刻結束的 `--exec`,spawn 出去的 watcher 跑完就死。

### 交叉臂測試——本輪最該加的一項

`watcher.pid` 是兩引擎**真正共用的交接檔**。TS 的 `ensureArmed` 寫進去,Python 的 `_watcher_state` 讀它並 `os.kill(pid, 0)` 探活;反過來也一樣。

這與 parity 那輪的 checkpoint round trip 同類,而且更難察覺:錯了的表現是「watcher 明明活著卻被判定不在」(於是重複 spawn)或「已死的 pid 被當成活的」(於是永遠不重 spawn),**兩者都不報錯**。

所以要有一組交叉臂測試:A 引擎 `arm-local`、B 引擎 `watcher-status`,兩個方向各驗一次。

## 風險

**1. detached 行程放大了 stale bundle 的後果。** TS 的 `ensureArmed` spawn 的是 `node dist/cli.js watch`。bundle 舊了,前景命令會當場出錯被看見;watcher 是背景跑好幾小時、沒人看的東西,它跑舊程式碼這件事可能很久都不會發現。既有防護(bundle 進版控、CI stale guard、`pretest` 自動重打包)仍適用,但這輪之後它們保護的東西變多了。

**2. shlex 寫歪是靜默的。** watcher 每次重試都跑被切錯的命令,輸出只進 `watcher-log.jsonl`。`watcher-status` 顯示的「最近一次嘗試」是唯一觀測窗口——這也是為什麼 `watcher-status` 要跟 `arm-local` 同一輪移植。

**3. 測試會留下孤兒行程。** `arm-local` 真的 spawn。所有測試用會立刻結束的 `--exec`,且測試結束要確認沒有殘留。

**4. `status` 補完的三件事各有來源。** `gate_cmds` 來自 config(M2a 已移植)、`--json` 是 `asdict(cp)` 加一個 `next` 鍵、watcher 警告來自本輪的 `_watcher_state`。三件都補齊才可以放回 `TS_COMMANDS`——M2b-1 的教訓就是「模組移植完不等於命令可以升級」,而 `crossEngine.test.ts` 現在會機械化擋住。

## 不做(YAGNI / 範圍外)

- 其餘 13 個變更型命令與 `units_cli` 的六個(M2c)
- `teardown` 的 CLI 子命令。模組移植,但命令牽連 merge 收尾流程,留 M2c 一起
- 刪除 Python(M2c)
- 不改 `SKILL.md` 的任何呼叫方式。對編排端透明是雙軌遷移的前提
- 不動 Python 引擎,除非 parity 又揭露 bug(已發生兩次:`??` 與 `Boolean()`)
- history 與 checkpoint 的時間戳文法統一(既有延後項,`adapter.json` 沿用相同處理)

## 待實作時決定

- `shlex` 移植的實作邊界:POSIX 模式即可(Python 的 `shlex.split` 預設 `posix=True`);Windows 語意不在範圍
- 第四個 Python 語意 helper 的落點(`jsonio.ts` 同族 vs 另立檔案)
- `runWatcher` 的 sleep 注入形狀(Python 是 `sleep_fn`;TS 需 async,影響 `watch` 命令的進入點形狀)
- 矩陣歸一化的欄位清單與豁免名單的表達方式
