# Cava 记事本：模块化结构

这是从原始单文件 `index.html` 拆分出的无构建工具版本。页面仍可直接双击 `index.html` 打开；资源均使用相对路径，加载顺序在 `index.html` 中明确声明。

## 目录

```text
index.html
assets/
  icons.svg             # 项目统一的 SVG 图标精灵
  css/
    base.css          # 变量、通用布局与导航
    chat.css          # 聊天界面与消息卡片
    ledger.css        # 账本与交易录入
    schedule.css      # 日程、日历与任务视图
    settings.css      # 设置页与主题
    modals.css        # 通用弹窗、侧边栏与裁剪器
    markdown.css      # Markdown 和代码块展示
    memory.css        # 摘要记忆管理界面
  js/modules/
    01-diary.js           # 日记生成与删除
    02-core.js            # Dexie 数据库、全局状态、初始化与配置
    02-cloud-sync.js       # Supabase 登录与非敏感数据双向同步
    03-event-listeners.js # 页面事件绑定
    04-chat.js            # 聊天、API 调用、消息渲染
    05-ledger.js          # 账本、图表与交易管理
    06-schedule.js        # 日程、日历与任务管理
    07-data-tools.js      # 筛选、头像处理、导入导出与侧边栏
    08-settings.js        # 弹窗工具、代理、角色、币种与表情包设置
    09-memory.js          # Memory 总结、召回、游标与管理
  js/icon-library.js      # appIcon()：动态界面的 SVG 图标助手
```

## 维护约定

- CSS 按页面功能维护，新增样式优先放入对应文件；若是跨页面样式，放入 `base.css` 或 `modals.css`。
- JavaScript 目前保留经典脚本和固定加载顺序，以确保原先的共享状态与函数调用不变。模块文件由 `index.html` 以 `defer` 顺序加载；不要随意调整顺序。
- 外部依赖 Dexie 和 Cropper.js 暂保持原有 CDN 引用，后续可在引入构建工具时改为 npm 依赖。
- 功能图标统一来自 `assets/icons.svg`。动态界面请调用 `appIcon('图标名')`，不要重新加入 emoji 或图标字体。
- 原始单文件应保留为 `index.single-file.backup.html`，它是最直接的回滚版本。

## 摘要记忆

- Dexie schema v11 新增 `memories` 表，既有 v10 数据会由 Dexie 原地升级并保留。
- Memory 设置和两套总结游标保存在 `appConfig.memorySettings` 中。
- AI 请求按“角色/System Prompt → 命中的 Memory → 最近原始消息”排列，Memory 使用独立 Token 上限。
- Memory 是底部导航中的独立页面，位于“日程”和“设置”之间。
- 摘要执行者可以选择 AI 角色，也可以直接选择已有代理中已启用的轻量模型。
- JSON 备份/恢复包含 `memories` 与 `diaries` 表。

## AI 日记上下文

- `appConfig` 中的 `diaryLookbackDays`、`diaryLookaheadDays` 与 `diaryContextMaxTokens` 分别控制目标日前后窗口和原始聊天 Token 上限，旧用户默认获得 `3 / 1 / 8000`。
- 日记通过 `buildDiaryContext()` 按用户本地日期筛选消息，不再使用普通聊天的最近消息窗口。
- 日记原始消息超限时优先保留目标日，再按日历距离保留邻近日；Memory 继续使用自身独立 Token 上限。
- 日记请求会排除 `startTime` 或 `endTime` 明确晚于允许结束时间的 Memory。

## Pre-MCP：完整安全数据同步

- Dexie schema v13 给配置、AI 代理与角色、账目、模板、币种、日程、日记和 Memory 增加云端身份与修改时间；旧数值 `id` 保留，跨设备关系通过 `syncId` 重建。
- 未登录时仍是纯本地应用；登录 Supabase 后自动双向同步用户资料、普通设置、AI Base URL、聊天、账本、日程、日记和 Memory。
- 使用最后修改时间决定哪一版胜出；离线修改保留为待同步，联网后自动继续。删除采用 `deletedAt` 标记，防止另一台设备把旧内容恢复。
- 上传前会递归剔除 Base64 数据、Blob 和密钥字段。图片、头像、背景、表情包图片、API Key、Supabase key、密码与 Token 不上传；`tokenLimit` / `maxTokens` 这类普通数值设置正常同步。
- Supabase 先运行 `supabase/001_messages_sync.sql`，再运行 `supabase/002_full_data_sync.sql`。完整设置步骤见 `SUPABASE-SETUP.md`。
- 当前版本已预填 CavaDailyNote 的 Project URL 与浏览器 Publishable key。严禁把 `service_role`、secret key 或数据库密码写进前端。
