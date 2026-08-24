# Supabase 设置：宝宝级施工单

这一版会打通：

```text
设备 A 的用户资料、普通设置、AI 设置、聊天、账本、日程、日记和 Memory
  ↓
Dexie 本地保存（立刻可见）
  ↓
Supabase 云端
  ↓
设备 B 的 Dexie 本地副本
```

Base64 图片、头像、背景、表情包图片和所有密钥都不会上传。Base URL、模型名、Token 上限等非密钥 AI 设置会同步；每台设备仍需单独填写 API Key。

## 你需要准备

- 一个 Supabase 账号。
- 一个新建或已有的 Supabase Project。
- Cava 的 `index.html`。

## 第 1 步：新建 Supabase Project

1. 打开 <https://supabase.com/dashboard> 并登录。
2. 点击 `New project`。
3. 随便取一个项目名，例如 `cava-note`。
4. Database Password 请使用密码管理器生成并保存。Cava 页面里不需要填写这个密码。
5. Region 选择离你常用地点较近的区域。
6. 点击创建，等项目显示为可用状态。

检查点：左侧应当能看到 `Table Editor`、`SQL Editor` 和 `Authentication`。

## 第 2 步：一键建表和权限

1. 在 Supabase 左侧点击 `SQL Editor`。
2. 点击 `New query`。
3. 打开项目里的 `supabase/001_messages_sync.sql`，全选并运行。
4. 再打开 `supabase/002_full_data_sync.sql`，全选并运行。
5. 两次结果都应显示 `Success. No rows returned`。

检查点：结果区不应有红色报错。然后进入 `Table Editor`，应能看到 `cava_messages` 和 `cava_records`。

这段 SQL 同时开启了 RLS。RLS 可以理解成数据库门卫：即使有人修改前端请求，也只能读取自己账号名下的聊天。

## 第 3 步：决定注册后是否必须确认邮箱

1. 左侧进入 `Authentication`。
2. 找到 `Providers`，打开 `Email`。
3. 保持 Email 登录开启。
4. 测试阶段如果不想来回点邮件，可以临时关闭 `Confirm email`；正式使用建议重新开启。

如果保持开启：在 Cava 点注册后，先去邮箱点确认链接，再回 Cava 点登录。

## 第 4 步：连接信息已经替你填好

当前这份 Cava 已经预填了本项目的两样浏览器公开连接信息：

1. `Project URL`
2. `Publishable key`

所以正常使用时不需要再去 Supabase 复制，也不需要点击“保存 Supabase 连接”。设置页保留这两个输入框，是为了以后换项目时还能修改。

绝对不要复制：

```text
service_role
secret key
数据库密码
```

Publishable/anon key 本来就是给浏览器使用的公开钥匙；真正的数据隔离由刚才的 RLS 门卫负责。

## 第 5 步：在 Cava 里连接

1. 双击打开 `index.html`。
2. 进入底部的“设置”。
3. 在最上面的“云同步”区域填自己的邮箱和密码。
4. 第一次用点“注册”；已有账号点“登录”。
5. 如果 Supabase 保持开启 `Confirm email`，去邮箱点一下确认链接，再回来登录。

检查点：聊天页右上角应从“本地模式”依次变成：

```text
待同步 N
  ↓
同步中
  ↓
已同步 12:34
```

## 第 6 步：两设备验收

设备 A：

1. 登录。
2. 发一句独特的文字，再新建一条测试账目或日程。
3. 等右上角显示“已同步”。

设备 B：

1. 打开同一份新版 Cava。
2. 填同一个 Supabase Project URL 和 Publishable key。
3. 登录同一个 Cava 邮箱账号。
4. 等待自动同步，或在设置里点“立即同步”。

检查点：设备 B 应看到“跨设备测试 0824”和刚才的测试账目/日程；若代理没有 API Key，这是正常的，需要在设备 B 本机填写。

再在设备 B 删除这句话，等两边同步。设备 A 上它也应消失，而且不会复活。

## 常见报错

### `Invalid API key`

粘贴错了 key。请重新复制 Publishable key 或 anon public key，不要用数据库密码。

### `relation "cava_messages" does not exist`

第 2 步 SQL 没有成功执行。回到 SQL Editor 重新完整运行文件。

### `new row violates row-level security policy`

通常是没有真正登录，或者 SQL 权限没有完整执行。先退出再登录；仍不行就重新运行 SQL 文件。

### 注册成功但登录失败

如果启用了 Confirm email，请先去邮箱点击确认链接。

### 一直显示“本地 · 待同步 N”

说明本地写入正常，但还没有登录。登录后会自动上传。

### 图片没有出现在另一台设备

这是明确设计，不是故障。Base64 图片只保存在原设备本地。
