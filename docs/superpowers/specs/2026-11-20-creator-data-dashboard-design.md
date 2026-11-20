# 自媒体数据看板设计

日期：2026-11-20  
暂定项目名：`maitian-insight`

## 1. 意图

做一个独立开源项目，服务单个创作者查看自己的抖音、小红书、微信视频号数据。

产品只有两个核心结果：

1. 定时采集三个平台的账号与作品数据。
2. 用有高级感、可长期使用的看板展示数据。

它不是内容发布工具，也不是社媒自动化平台。

## 2. 成功标准

- 用户在本机扫码登录三个创作者后台后，可以一键采集。
- 每个平台至少采集：粉丝总数、作品封面、发布时间、播放、点赞、评论、收藏、分享。
- 数据按时间保存，重复采集更新当天快照，不制造重复记录。
- 同一内容在三个平台的表现可以并排比较。
- Windows 可以每天定时采集一次，登录失效时明确提示具体平台。
- 看板首屏在 1440px 桌面宽度下完整、稳定、可读。
- 项目不需要云服务器、账号密码或平台开放平台审核即可运行。

## 3. 非目标

- 不发布、删除、点赞、评论、私信或管理作品。
- 不采集竞品账号和陌生人的数据。
- 不做 AI 内容生成、运营建议聊天机器人或团队权限。
- 不做移动 App、Docker 集群、云同步、多租户或插件市场。
- 第一版不接抖音官方 OAuth。官方权限申请成功后再评估替换抖音采集器。

## 4. 约束

- 本地优先。Cookie 只保存在本机浏览器 Profile。
- 只操作用户已经登录的创作者后台。
- 采集器不得调用发布、互动或删除类接口。
- 页面私有接口会变化，因此采集层必须与展示层分开。
- 只复制许可证允许复用的代码。开源不等于可以忽略许可证。
- 对 MIT/Apache-2.0 来源保留版权声明和第三方清单；无许可证项目只参考行为。

## 5. 方案比较

### 方案 A：只用官方 API

优点：数据契约清楚，长期风险低。  
缺点：小红书和视频号缺少普通创作者完整分析 API；抖音数据权限需要申请。无法完成三个平台统一采集。

### 方案 B：复制麦田现有 DOM 采集

优点：代码少，当前账号已经跑通。  
缺点：抖音依赖 React Fiber，小红书依赖 DOM 顺序，视频号依赖 Shadow DOM 文本。页面改版后容易失效。

### 方案 C：本地浏览器响应优先，DOM 兜底

优点：三个平台使用同一运行方式；优先读取页面已请求的结构化 JSON；不要求开放平台审核。  
缺点：仍依赖创作者后台，平台改版后需要维护适配器。

### 选择

采用方案 C。

第一版不同时实现多套数据源。每个平台只有一个默认采集器：

1. 捕获创作者后台自动产生的结构化响应。
2. 必要时在同源页面执行只读请求。
3. 没有结构化数据时才读取 DOM。
4. 登录失效时明确提示重新扫码。第一版不做 CSV/XLSX 导入。

## 6. 借鉴来源

- `mdldm-maitian`：专用 Chrome Profile、SQLite 快照、3D 封面卡、平台配色和本地看板。MIT。
- `video-data-dashboard`：三平台采集、SQLite、ECharts 和 Windows 任务计划结构。MIT。
- `xhs-analytics`：小红书本人账号采集和本地分析。MIT。
- `xiaohongshu-mcp`：只参考登录和页面访问方式；它不是创作者统计数据源。Apache-2.0。
- `creator-platform-data`、`social-harvest`：只参考采集边界和字段映射，未确认许可证前不复制源码。

## 7. 技术选择

- Node.js 22。
- `playwright-core` 驱动本机 Google Chrome，使用持久化 Profile。
- Node 内置 `node:sqlite`。
- Node 内置 HTTP 服务。
- 原生 HTML、CSS、JavaScript。
- 本地 vendored Apache ECharts，只用于折线图和柱状图。
- Windows 任务计划程序每天运行一次 `collect`。

不引入 React、Next.js、Tailwind、ORM、队列或后台框架。

## 8. 项目结构

```text
maitian-insight/
  src/
    cli.mjs
    browser.mjs
    db.mjs
    collect.mjs
    server.mjs
    platforms/
      douyin.mjs
      xiaohongshu.mjs
      channels.mjs
    web/
      index.html
      app.js
      styles.css
      vendor/echarts.min.js
  scripts/
    install-task.ps1
    uninstall-task.ps1
  data/
    browser-profile/
    insight.db
  test/
    parsers.test.mjs
  THIRD_PARTY_NOTICES.md
  README.md
  LICENSE
```

## 9. 命令

```text
node src/cli.mjs login
node src/cli.mjs collect
node src/cli.mjs doctor
node src/cli.mjs serve
```

- `login`：打开三个创作者后台，用户自行扫码。
- `collect`：依次采集三平台，写入 SQLite。
- `doctor`：只检查登录和最后采集状态。
- `serve`：启动本地看板。

第一版没有常驻 daemon。每天执行交给 Windows 任务计划程序。

任务设置为“仅用户登录时运行”。允许锁屏时执行，不承诺用户注销后执行。Chrome 使用有界面模式，不使用无头模式。

## 10. 采集流程

```text
任务计划 / 手动命令
        ↓
打开持久化 Chrome Profile
        ↓
按平台顺序进入创作者后台
        ↓
监听页面网络响应
        ↓
解析账号、作品、指标
        ↓
验证字段和完整性
        ↓
保存原始响应摘要与统一快照
        ↓
关闭本轮标签页
```

三个平台串行采集。平台之间等待 2 秒。单个平台失败不阻断另外两个平台。

首次采集每个平台最多回填最近 90 天或 100 条作品，以先达到者为准。每日采集拉取新作品，并刷新最近 30 天作品的指标。分页失败、平台显示总数大于实际获取数或达到 100 条上限时，记录 `partial`。

首次实机开发使用现有 `D:\AI\mdldm-maitian\chrome-profile` 的本人登录态，只做读取和脱敏字段确认。新项目默认使用自己的 `data/browser-profile/`，不复制、提交或上传旧 Profile。

### 抖音

- 账号：创作者首页的账号信息与粉丝趋势响应。
- 作品：内容管理页的作品列表响应。
- 匹配：`aweme_id` 优先，标题只作回退。
- 不再读取 React `__reactFiber`。

### 小红书

- 账号：粉丝数据页的账号与趋势响应。
- 作品：笔记管理或内容分析页的列表响应。
- 匹配：`note_id` 优先，标题只作回退。
- 不再依赖 `.note-card__stat` 的固定顺序。

### 视频号

- 账号：视频号助手数据中心页面响应。
- 作品：作品管理页面响应。
- 优先读取后台返回的 JSON；Shadow DOM 只用于发现登录状态和最后兜底。
- 匹配：作品 ID 优先；拿不到 ID 时用标题首行与发布时间。

## 11. 数据模型

只建六张业务表：

### `accounts`

平台账号。字段：`platform`、`platform_account_id`、`display_name`、`avatar_url`。

### `account_snapshots`

账号快照。字段：`platform`、`captured_at`、`followers`、`following`、`likes_received`。

### `contents`

跨平台内容组。字段：`id`、`title`、`cover_path`、`published_at`。

### `platform_posts`

平台作品。字段：`platform`、`post_id`、`content_id`、`title`、`url`、`cover_url`、`published_at`。

### `metric_snapshots`

作品快照。字段：`platform`、`post_id`、`captured_at`、`views`、`likes`、`comments`、`favorites`、`shares`。

### `collector_runs`

采集记录。字段：`platform`、`started_at`、`finished_at`、`status`、`items`、`error`、`schema_version`。

平台缺失的指标存 `NULL`，绝不存成 `0`。

## 12. 跨平台内容配对

第一版使用可解释规则：

1. 标题标准化后完全相同，并且发布时间相差不超过 72 小时，则自动归为同一内容。
2. 不能确定时保持三个独立内容，不做模糊 AI 判断。
3. 数据库支持后续手动修改 `content_id`，第一版界面不做复杂配对工具。

## 13. 看板信息架构

第一版只有两个页面。

### 大屏 `/`

- 顶栏：项目名、最后采集时间、三个平台登录灯、立即采集按钮。
- 左上：最新内容 3D 封面卡，保留麦田的轻微透视和自动封面。
- 中上：总粉丝和 30 天平台粉丝趋势。
- 右上：数据摘要，使用确定性规则生成，不调用 AI。
- 下半：三个平台表现卡和最近内容横向比较柱状图。

### 内容 `/content`

- 跨平台内容列表。
- 支持按时间和平台筛选。
- 点击内容后展开三平台指标、互动率和采集时间。

采集设置不单独做页面。登录、采集和错误提示放在顶栏状态面板。

互动率统一定义为 `(点赞 + 评论 + 收藏 + 分享) / 播放`。播放为 `NULL` 或 `0` 时，互动率显示为未知，不显示 `0%`。

确定性摘要只生成三类：近 7 天涨粉最多的平台、最近内容播放占比最高的平台、最近内容相对该平台历史中位数的表现。缺少所需数据时不生成对应摘要。

## 14. 视觉系统

沿用麦田的浅色克制风格，但减少发布系统元素。

- 背景：`#F4F4F6`，带低对比蓝红环境光。
- 卡片：白色、20px 圆角、轻边框和两级阴影。
- 文字：系统字体；数字使用 tabular numerals。
- 平台色：小红书 `#FF2442`、抖音 `#1D1D1F`、视频号 `#FA9D3B`。
- 主强调色：`#0071E3`，只用于交互和统一指标。
- 卡片间距：16px；页面边距：22px。
- 动效只保留图表入场和封面轻微漂浮，并支持 `prefers-reduced-motion`。

避免玻璃拟态堆叠、霓虹渐变、3D 图表、无限轮播和装饰性仪表盘。

## 15. 错误和完整性

- 每个平台单独记录成功、未登录、页面变更、数据不完整和网络错误。
- 采集结果必须包含平台总数和实际获取数。
- 只抓到第一页时标记 `partial`，看板显示“不完整”，不静默展示。
- 连续失败不会删除旧数据。
- 解析器无法识别字段时保存错误摘要，不把原始 Cookie、Token 或完整私密响应写入日志。

## 16. 安全和隐私

- `data/`、浏览器 Profile、数据库和导入文件全部写入 `.gitignore`。
- 看板默认只监听 `127.0.0.1`。
- 不提供公网暴露、云同步或远程登录功能。
- README 明确说明本项目读取本人后台，用户应遵守平台规则。

## 17. 验证

### 自动验证

- 三个平台解析器各有一个脱敏 fixture 测试。
- SQLite upsert、`NULL` 指标、内容配对各有一个测试。
- `node --test` 通过。
- 前端脚本通过 `node --check`。

### 实机验证

- 三个平台分别完成一次登录检查。
- 三个平台分别采到至少一个账号快照和一个作品快照。
- 连续采集两次不产生重复作品。
- Windows 任务计划程序手动触发成功。
- 看板在 1440px 和 390px 宽度下无横向溢出。

## 18. 停止条件

满足成功标准后停止。以下内容留到真实需求出现后再做：

- 抖音官方 OAuth 适配器。
- 多账号、多用户、团队权限。
- 云部署、Docker、远程数据库。
- 更多平台和 AI 洞察。
- CSV/XLSX 导入、自动导出和自动发布。

