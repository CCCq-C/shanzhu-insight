# 贡献指南

感谢参与山竹洞察。项目优先接受小而完整、可验证、不会暴露账号数据的改动。

## 开始前

- Bug 请使用 Bug Report 模板，并删除 Cookie、账号 ID、真实接口响应和未脱敏截图。
- 新平台、采集方式或大范围界面调整，请先创建 Feature Request 说明范围。
- 只提交自己有权使用的代码、文档和测试数据。

## 本地开发

```powershell
git clone https://github.com/CCCq-C/shanzhu-insight.git
cd shanzhu-insight
npm ci
npm test
npm run check
```

## Pull Request

1. 从最新 `main` 创建分支。
2. 一个 PR 只解决一个问题。
3. 行为变化必须包含测试；先证明测试会失败，再提交修复。
4. 保持现有本地优先架构，不上传 Cookie、数据库或原始平台响应。
5. 填写 PR 模板，并确认 CI 通过。

提交即表示你同意按项目的 [MIT License](LICENSE) 发布贡献，并遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
