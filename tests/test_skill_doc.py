from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins/dev-loop/skills/dev-loop/SKILL.md"


def _text():
    return SKILL.read_text(encoding="utf-8")


def test_skill_documents_graph_build_on_first_start():
    t = _text()
    assert "code-review-graph build -q" in t
    assert ".code-review-graph/" in t


def test_skill_documents_graph_update_before_impact():
    """update 必須緊接在 impact 之前跑(步驟 8 開頭),這樣 apply 與每一輪 fix
    的異動都會在 review 讀圖前補齊——只在步驟 5(apply 結束)跑一次的話,fix 輪
    產生的檔案永遠進不了圖(fix 檔早就在下一次 update 的 diff 窗外)。"""
    t = _text()
    seg = _slice(t, "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "code-review-graph update -q --base" in seg
    update_pos = seg.index("code-review-graph update -q --base")
    impact_pos = seg.index("code-review-graph impact --files")
    assert update_pos < impact_pos


def test_skill_no_longer_updates_graph_at_apply_step():
    """步驟 5 的 update 呼叫是多餘的(步驟 8 開頭已覆蓋 apply + 每輪 fix),
    留著容易讓人以為 fix 輪的異動也會被那次 update 收到——移除以求單一事實來源。"""
    seg = _slice(_text(), "5. **Apply", "6. **Hard gate**")
    assert "code-review-graph update" not in seg


def test_skill_documents_graph_impact_for_review():
    t = _text()
    assert "code-review-graph impact --files" in t
    assert "impacted_files" in t
    # Lock the flag values, not just the flag names — a future edit that
    # changes or drops these should fail this test.
    assert "--depth 2" in t
    assert "--max-results 50" in t


def test_skill_documents_impact_files_source_is_explicit():
    """"本次改動檔" 必須有明確、可執行的來源命令,而不是留給 agent 自己猜。"""
    t = _text()
    assert "git diff <trunk>...HEAD --name-only" in t


def _slice(text, start_marker, end_marker):
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[start:end]


def test_skill_documents_graceful_degradation_anchor_a_build():
    """核心迴圈第 1 點的 code-review-graph build 段必須自帶降級敘述。"""
    seg = _slice(_text(), "順手備妥 code-review-graph", "2. **推進到卡點**")
    assert "跳過" in seg
    assert "忽略" in seg


def test_skill_documents_graceful_degradation_anchor_c_review():
    """流程步驟 8 的 code-review-graph impact 段必須自帶降級敘述(退回讀整包 diff)。"""
    seg = _slice(_text(), "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "退回" in seg
    assert "整包 diff" in seg


def test_skill_documents_stale_graph_miss_falls_back_too():
    """圖沒涵蓋這批檔時,impact 是 exit 0 + 空陣列(不是非 0 退出)——只看 exit
    code 的降級判斷會漏接這種情況,範圍靜默塌縮成只有改動檔、reviewer 少看波及檔
    也沒人知道。必須把「impacted_files 與 changed_nodes 皆空」也當成退回讀整包
    diff 的觸發條件。"""
    seg = _slice(_text(), "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "changed_nodes" in seg
    assert "impacted_files" in seg
    assert "退回現行做法" in seg
    # 降級句要同時覆蓋「非 0 退出」與「兩個陣列皆空」兩種觸發條件
    assert "皆為空" in seg or "都是空" in seg or "均為空" in seg


def test_skill_clarifies_two_explicit_reading_inputs_for_legs():
    """"取代讀整包 diff" 讀起來會讓人以為 leg subagent 只拿到檔名清單、完全沒看到
    diff——必須把兩個輸入攤開寫清楚:(a) 範圍化 diff 看改了什麼,(b) 波及檔(不在
    改動集合裡的 impacted_files)的現在內容當上下文,而不是全部只給檔案內容。"""
    seg = _slice(_text(), "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "git diff <trunk>...HEAD -- " in seg
    assert "目前內容" in seg or "現在內容" in seg


def test_skill_documents_impacted_files_path_normalization():
    """impacted_files 是絕對路徑,git diff --name-only 是 repo-relative——兩者
    直接聯集會讓同一個檔案用兩種寫法各算一次。必須明講要先正規化成 repo-relative
    再比較/聯集。"""
    seg = _slice(_text(), "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "絕對路徑" in seg
    assert "正規化" in seg or "normalize" in seg.lower()
