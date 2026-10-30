# 测试页面快照

`tests/run.mjs` 用这些页面跑识别回归，并与 `../baseline.json` 对比题数与题型序列。

| 文件 | 来源 | 题数 | 覆盖的结构 |
|------|------|------|-----------|
| `jutiku-real.html` | `https://www.jutiku.cn/test?pid=5991` 真实页面（登录态）抓取 | 46 | `<li>` 平铺容器 + 字母选项 + 题干碎片串扰 |
| `jutiku-style.html` | 简化构造 | 3 | 题干与选项同层、无 per-question 容器 |
| `edusoho.html` | 构造 | 2 | EduSoho 的 `.ibs-engine` 题目容器 |
| `contenteditable.html` | 构造 | 2 | `contenteditable` 简答框 |
| `radio-group-zh.html` | 构造 | 2 | `role="radio"` / `aria-checked`，无 class 线索 |
| `mixed-sections.html` | 构造 | 6 | 单选 + 多选 + 填空 + 简答混排，靠分节标题校正题型 |

## 脱敏说明

`jutiku-real.html` 原样抓取自登录态页面，入库前已把两处与账号绑定的值换成固定假值：

| 位置 | 原始 | 当前 |
|------|------|------|
| `<meta name="csrf-token">` | 真实会话 token | `FAKE-CSRF-TOKEN-DESENSITIZED-0000` |
| `data-userpaper` / `name="user_paper_id"` | 真实答题记录号（48 处） | `10000001` |

替换只动这两个值，页面结构、题目内容、`data-id` 全部原样，因此识别结果不受影响（脱敏后基线仍为 46 题全一致）。

其余内容为公开试卷正文与站点通用脚本引用，不含个人信息。

## 重新抓取时

```bash
# 需要 Chrome 以 --remote-debugging-port=9222 启动（Windows 可用仓库根的 start-debug-chrome.bat 起独立实例）
node tests/analyze-jutiku.mjs     # 输出识别结果，并把当前 DOM 写入 jutiku-real.html
```

抓完**必须再脱敏一遍**（把下面两个占位符替换成实际抓到的值，注意它们在单引号内，不会被 shell 当成重定向）：

```bash
# 把 <实际token> 和 <实际userpaper号> 替换成页面里搜到的真实值
sed -i 's/<实际token>/FAKE-CSRF-TOKEN-DESENSITIZED-0000/g; s/<实际userpaper号>/10000001/g' tests/fixtures/jutiku-real.html
```

确认没有残留再提交：

```bash
grep -c 'csrf-token' tests/fixtures/jutiku-real.html      # 应为 1，值为 FAKE-...
grep -oE 'data-userpaper="[0-9]+"' tests/fixtures/jutiku-real.html | sort -u   # 应只有 10000001
```

页面结构若有变化，跑 `node tests/run.mjs --update` 刷新基线——**但只在确认变化是预期的之后**，否则等于把 bug 写进基线。
