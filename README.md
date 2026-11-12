# Git 冒险者公会 · 留言墙

面向计算机学院新生的 Git 入门项目。Fork 公会仓库，新增一份 Markdown 留言，再通过 Pull Request 参与一次真实的开源协作。

## 本地开发

需要 Node.js 26 LTS 和 npm。在 Windows PowerShell 中运行：

```powershell
npm.cmd install
npm.cmd run dev
```

常用检查命令：

```powershell
npm.cmd test
npm.cmd run validate
npm.cmd run build
```

## 如何提交留言

你不需要填写 YAML，也不需要在文件名里写日期或 GitHub 用户名。

1. 在公会仓库页面点 **Fork**，把仓库复制到自己的 GitHub 账号。
2. 用 GitHub Desktop 打开你的 Fork（也可以用 `git clone` 下载到电脑）。
3. 复制 `messages/_template.md`，在 `messages/` 目录新建一个 `.md` 文件，例如 `hello.md`。
4. 打开新文件，把模板文字改成你自己的留言。可以写普通文字、标题、列表、引用或代码；不要加入 HTML 或图片。每条留言最多 10 KB。
5. 在 GitHub Desktop 里填写提交说明，点 **Commit**，再点 **Push origin**。
6. 点 **Preview Pull Request**，检查改动只包含你新加的留言文件，然后创建 Pull Request。
7. 等待公会维护者审核并合并。合并后，留言会出现在网站上。

也可以在 GitHub 网页上打开自己的 Fork，选择 **Add file → Create new file**，路径填写 `messages/hello.md`，写好留言后选择 **Commit changes**，再点 **Contribute → Open pull request**。

文件第一行的一级标题（以 `# ` 开头）会作为留言标题。没有作者资料时，网站会显示“匿名冒险者”；不会把文件名误当成 GitHub 身份。旧版带 YAML Front Matter 的留言仍然兼容。

留言合并后，自动化会从 GitHub PR 记录中读取提交者用户名，并与新增留言文件对应。Markdown 中填写的 `author` 或 `github` 不会作为身份凭据；没有可信记录的历史留言继续匿名显示。

## 项目结构

- `src/`：前端源码
- `messages/`：Markdown 留言
- `scripts/`：留言校验、数据生成和测试
- `public/messages.json`：构建时生成的前端数据
- `.github/workflows/`：PR 校验与 GitHub Pages 部署

部署设置与审核规则见 [`docs/deployment.md`](docs/deployment.md)。GitHub Pages 的来源需要设为 **GitHub Actions**。
