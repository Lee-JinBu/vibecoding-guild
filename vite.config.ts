import { defineConfig } from "vite";

// Actions 会自动使用实际仓库名；本地开发和未知仓库场景使用根路径。
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({ base });
