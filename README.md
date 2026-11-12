# Git 冒险者公会 · 留言墙

面向计算机学院新生的 Git 入门课程项目。学生通过 Fork、Clone、添加 Markdown 留言、Commit、Push 和 Pull Request 参与协作；审核合并后的留言将由静态网页展示。

## 本地开发

需要 Node.js 26 LTS 和 npm。在 Windows PowerShell 中运行：

```powershell
npm.cmd install
npm.cmd run dev
```

校验留言并生成 `public/messages.json`：

```powershell
npm.cmd run validate
npm.cmd test
npm.cmd run build
```

## 提交留言格式

复制 `messages/_template.md`，改名为 `YYYY-MM-DD-昵称.md`。文件必须包含 YAML Front Matter：

```markdown
---
author: 冒险者
github: your-github-username
---

写下你的留言。
```

`author` 和 `github` 都是必填字段，GitHub 用户名不能重复。单个留言文件最多 10 KB。只允许安全的 Markdown 文本和 http/https 链接；原始 HTML、图片及其他链接协议会被拒绝。以下划线开头的文件视为模板，不参与生成。

## 项目结构

- `src/`：前端源码
- `messages/`：Markdown 留言
- `scripts/`：留言读取、校验和测试
- `public/messages.json`：构建时生成的前端数据
- `.github/workflows/`：校验与 GitHub Pages 部署工作流

GitHub Pages 部署前，请在仓库设置中将 Pages 来源设为 **GitHub Actions**。

PR 留言范围校验、部署流程和 GitHub 仓库设置说明见 [`docs/deployment.md`](docs/deployment.md)。
