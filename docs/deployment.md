# GitHub Actions 与 Pages 部署

## PR 留言校验

`.github/workflows/pr-validation.yml` 只响应目标为 `main` 的 Pull Request。它以只读权限检出目标分支中的校验脚本，获取 PR head 后计算 merge-base，并检查从 merge-base 到 PR head 的**全部变更**。PR 必须只新增一个 `messages/` 下的 `.md` 文件；不能修改或删除已有文件，也不能更改源码、依赖、文档或工作流。文件名不需要日期或用户名，也不要求 Front Matter。

留言不能超过 10 KB，不能包含原始 HTML、图片或危险链接。Front Matter 是可选的；没有作者信息时，留言以“匿名冒险者”显示。文件中的第一个一级标题会作为留言标题。

校验过程将 PR Markdown 当作数据读取，不检出或运行 PR 中的脚本。工作流使用 `pull_request`，不使用 `pull_request_target`；不授予写权限，也不读取仓库密钥。

## 网站部署

`.github/workflows/pages.yml` 仅在主仓库 `main` 分支收到 push 后运行。它安装锁定依赖、测试、校验并生成 `public/messages.json`、构建 `dist/`，然后使用 GitHub 官方 Pages Actions 上传和部署。PR 事件不会触发这个工作流。

Vite 会读取 Actions 提供的 `GITHUB_REPOSITORY` 自动设置项目仓库子路径；无需填写用户名或仓库名。

## GitHub 仓库设置（需维护者手动完成）

1. 打开 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
2. 在 **Settings → Actions → General → Workflow permissions** 保持只读权限即可；工作流在部署 job 内单独申请 Pages 所需的 `pages: write` 和 `id-token: write`。
3. 建议在 **Settings → Branches** 为 `main` 添加保护规则，要求合并前通过 **PR 留言校验** 状态检查。
4. 同时要求至少一位维护者审批，避免未审核的工作流改动进入 `main`。GitHub 的 `pull_request` 工作流定义来自 PR 合并提交；本工作流会检出目标分支脚本且不运行 PR 中的应用源码，但 GitHub 仓库保护规则仍需由维护者设置。
5. 检查仓库默认分支为 `main`。首次部署完成后，Pages 页面会显示网站地址。

无需创建或添加个人访问令牌。Fork PR 的校验 token 只有 `contents: read`，不会部署网站。
