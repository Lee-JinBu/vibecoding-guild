# GitHub Actions 与 Pages 部署

## PR 留言校验

`.github/workflows/pr-validation.yml` 只响应目标为 `main` 的 Pull Request。它以只读权限检出目标分支中的校验脚本，获取 PR head 后计算 merge-base，并检查从 merge-base 到 PR head 的**全部变更**。PR 必须只新增一个 `messages/` 下的 `.md` 文件；不能修改或删除已有文件，也不能更改源码、依赖、文档或工作流。文件名不需要日期或用户名，也不要求 Front Matter。

留言不能超过 10 KB，不能包含原始 HTML、图片或危险链接。Front Matter 是可选的；没有作者信息时，留言以“匿名冒险者”显示。文件中的第一个一级标题会作为留言标题。

校验过程使用 `pull_request_target` 从目标分支加载可信工作流和脚本，但只授予 `contents: read`，不配置或读取仓库密钥。它仅检出目标分支的 base SHA，通过 Git 读取 PR 文件并将 Markdown 当作数据解析，不检出 PR head，也不运行 Fork 中的脚本。

## 网站部署

`.github/workflows/pages.yml` 在主仓库 `main` 分支收到 push，或作者映射更新工作流发送 `message-authors-updated` dispatch 后运行。它安装锁定依赖、测试、校验并生成 `public/messages.json`、构建 `dist/`，然后使用 GitHub 官方 Pages Actions 上传和部署。PR 事件不会直接触发这个工作流。

Vite 会读取 Actions 提供的 `GITHUB_REPOSITORY` 自动设置项目仓库子路径；无需填写用户名或仓库名。

## GitHub 仓库设置（需维护者手动完成）

1. 打开 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
2. 在 **Settings → Actions → General → Workflow permissions** 保持只读权限即可；工作流在部署 job 内单独申请 Pages 所需的 `pages: write` 和 `id-token: write`。
3. **必须**为 `main` 配置保护规则或 ruleset：要求合并前通过 **PR 留言校验** 状态检查，并要求至少一位维护者审批。否则 GitHub 会允许绕过失败的 PR 校验，留言 PR 可能修改或删除作者映射。登记工作流本身也会拒绝包含其他改动的 PR。
4. 作者登记工作流使用自己的 `contents: write` token 直接更新映射。若规则要求所有 `main` 更新必须经 PR，需在仓库规则中允许 GitHub Actions 工作流写入该自动生成文件；否则 GitHub 会拒绝更新，工作流失败。只授权所需的工作流身份，并保留 PR 校验与人工审批规则。
5. 检查仓库默认分支为 `main`。首次部署完成后，Pages 页面会显示网站地址。

无需创建或添加个人访问令牌。Fork PR 的校验 token 只有 `contents: read`，不会部署网站。

# 留言作者显示

PR 校验仍只读。留言 PR 合并后，`record-message-authors.yml` 才会运行：它只检出 `main` 上可信的脚本，从 GitHub PR API 读取 PR 作者和文件列表，并将新增留言文件与该 GitHub 用户名登记到 `data/message-authors.json`。它会再检查 PR 的完整文件清单必须只含一条新增留言，映射文件无法通过留言 PR 一并修改。

这个工作流不会检出或执行 Fork 中的代码。普通留言作者不能通过 Front Matter 的 `author`、`github` 字段指定展示身份。作者登记使用待处理队列和文件 SHA 冲突重试，避免连续合并时丢失映射；映射更新后会用 `repository_dispatch` 触发 Pages 工作流重新生成留言数据并部署。未登记的历史留言继续匿名显示；文件名不会被用来猜测身份。
