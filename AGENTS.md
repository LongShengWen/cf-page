# Repository Guidelines

## Project Structure & Module Organization
本仓库目标：Vue 3 + TypeScript 导航页，部署到 Cloudflare Workers，并提供导航数据存储（D1 SQL）与 API 更新。
建议结构：
- `src/`：Worker 源码（API + 静态资源路由），入口 `src/index.ts`。
- `web/`：前端工程（Vite），入口 `web/src/main.ts`。
- `web/public/`：静态文件。
- `tests/`：测试。
- `wrangler.toml`：Worker 配置与 D1 绑定。
- `web/dist/`：前端构建产物（部署时由 Worker 读取）。

## Architecture Overview
Worker 负责：
- 提供静态页面（`web/dist`，通过 `ASSETS` 绑定）。
- 提供 API：`GET /api/nav` 获取导航，`PUT /api/nav` 更新导航（需鉴权）。
静态资源使用 SPA 回退（`not_found_handling = "single-page-application"`）。
导航数据存于 D1（绑定名 `NAV_DB`，表 `nav`），结构示例：
```json
[{"title":"Tools","items":[{"name":"Docs","url":"https://..."}]}]
```
API 需校验 `Authorization: Bearer <ADMIN_TOKEN>` 或 `X-Admin-Token`，失败返回 401。

## Build, Test, and Development Commands
约定使用 Node + Vite + Wrangler：
- `npm install`：安装依赖。
- `npm run dev`：仅启动前端（Vite）。
- `npm run worker:dev`：本地启动 Worker（API）。
- `wrangler d1 migrations apply NAV_DB --local`：本地应用 D1 迁移。
- `wrangler d1 migrations apply NAV_DB`：线上应用 D1 迁移。
- `npm run build`：构建前端到 `web/dist/`。
- `npm run deploy`：发布到 Cloudflare Workers（先构建再部署）。
- `npm run lint` / `npm run format`：代码检查与格式化。
如需一键启动前后端，可新增组合脚本，并同步 README 与 CI。

## Coding Style & Naming Conventions
- 缩进 2 空格，LF 结尾。
- Vue 使用 `<script setup>`，TypeScript `strict`。
- 命名：目录 `kebab-case`，组件 `PascalCase`，变量 `camelCase`。
- 工具：`eslint` + `prettier`，导入顺序按标准库/第三方/项目内分组。

## Testing Guidelines
- 前端建议使用 `vitest`，Worker 可用 `miniflare` 或 `wrangler` 测试。
- 文件命名 `*.spec.ts`，与源码同名。
- 新功能需补测试；修复需加回归用例。

## Security & Configuration Tips
- 本地使用 `.dev.vars` 或 `.env.example`，不要提交真实密钥。
- `ADMIN_TOKEN` 与 D1 绑定在 `wrangler.toml` 中配置。
- 更新导航 API 的请求体需校验 JSON 结构与 URL 格式。

## Commit & Pull Request Guidelines
- 使用 Conventional Commits（如 `feat: add nav api`）。
- PR 需说明变更、关联任务、必要的截图或 API 示例。
- 自检项：文档、测试、配置是否同步更新。

## Dependency Management
提交锁定文件（如 `package-lock.json`/`pnpm-lock.yaml`），新增依赖需说明用途。
