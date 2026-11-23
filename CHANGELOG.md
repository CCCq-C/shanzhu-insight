# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-11-23

### 新增

- README 首屏增加总览看板、内容档案和跨平台深度对比界面图。

### 修复

- 按秒解析视频号 `videoPlayLen`，修复观看进度被放大 1000 倍的问题。
- 启动时自动修正已经保存的错误视频号历史时长。

## [0.1.0] - 2026-11-21

### 新增

- 抖音、小红书、视频号并行采集与本地看板。
- 粉丝趋势、内容合并、深度指标和封面缓存。
- 后台定时采集、登录状态和 Windows 计划任务。

### 安全

- 拒绝将同平台不同账号写入同一数据目录。
- 本地写接口增加请求标记、Host 和 Origin 校验。
- 测试和文档移除真实账号标识。

[0.1.1]: https://github.com/CCCq-C/shanzhu-insight/releases/tag/v0.1.1
[0.1.0]: https://github.com/CCCq-C/shanzhu-insight/releases/tag/v0.1.0
