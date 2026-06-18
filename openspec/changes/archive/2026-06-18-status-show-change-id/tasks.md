## 1. 擴充 status 輸出

- [x] 1.1 在 `tests/test_cli.py` 新增測試:status 輸出包含 `change_id=` 與 `branch=`(先寫,確認失敗)
- [x] 1.2 修改 `devloop/cli.py` 的 `_cmd_status`,在輸出尾端追加 `change_id` 與 `branch`
- [x] 1.3 跑全套測試確認綠且既有 status 測試不受影響
