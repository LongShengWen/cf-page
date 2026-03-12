# Home CF Navigation

基于 Vue 3 + TypeScript 的导航页，部署在 Cloudflare Workers 上。Worker 负责提供静态页面与 API，并使用 D1 数据库存储导航数据。

## 一键部署到 Cloudflare
点击下方按钮即可在 Cloudflare 上创建并部署本项目：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LongShengWen/cf-page)

说明：一键部署会以当前仓库作为“种子仓库”，并在你的 GitHub 账户下创建一个新仓库（名称通常是 `home-cf`），Cloudflare 之后会绑定这个新仓库进行构建部署。如果你希望直接使用原仓库 `cf-page`，请在 Cloudflare 控制台手动连接该仓库与分支。

部署完成后仍需在 Cloudflare 控制台完成以下配置：
- 绑定 D1 数据库（NAV_DB）
- 绑定 R2 桶（ICON_BUCKET，可选）
- 设置密钥 `ADMIN_TOKEN`
- 可选：设置变量 `SEED_DATA`（JSON 字符串），用于首次初始化数据
  例如：
  ```json
  {"settings":{"title":"团队导航","subtitle":"","announcement":"","footerNote":"","defaultView":"external","cardStyle":"follow","backgroundImage":"","theme":"aqua"},"groups":[]}
  ```

## Features
- Vue 3 + Vite 前端
- Worker API：`GET /api/nav`、`PUT /api/nav`
- D1 SQL 存储（表 `nav`）
- SPA 回退（`not_found_handling = "single-page-application"`）
- 单一认证口令登录（由 `ADMIN_TOKEN` 配置）

## Project Structure
- `src/`：Worker 源码（API + 静态资源路由）
- `web/`：前端工程（Vite）
- `migrations/`：D1 迁移
- `wrangler.toml`：Worker + D1 + 静态资源配置

## Requirements
- Node.js 18+
- Wrangler CLI（已在根 `package.json` 中声明）

## Setup
1. 安装依赖
```bash
npm install
npm --prefix web install
```

2. 创建 D1 数据库并写入 `wrangler.toml`
```bash
wrangler d1 create nav_db
```
将输出的 `database_id` 和 `preview_database_id` 填入 `wrangler.toml`。

3. 应用迁移
```bash
wrangler d1 migrations apply NAV_DB --local
```

4. 创建 R2 图标桶（可选）
```bash
wrangler r2 bucket create nav-icons
wrangler r2 bucket create nav-icons-preview
```
上传图标示例：
```bash
wrangler r2 object put nav-icons/logo.png --file ./logo.png --content-type image/png
```
前端使用时，将 `imageUrl` 设置为 `/icons/logo.png`。

5. 配置本地密钥
创建 `.dev.vars`：
```bash
ADMIN_TOKEN=your_token
```

## Local Development
1. 启动 Worker API
```bash
npm run worker:dev
```
默认端口 `8787`。

2. 启动前端
```bash
npm run dev
```
前端默认端口为 `5174`，Vite 代理 `/api` 到 `http://127.0.0.1:8787`。

## Build & Deploy
构建前端并发布 Worker：
```bash
npm run deploy
```

单独构建前端：
```bash
npm run build
```

## API
- `GET /api/nav`：获取导航数据（需要鉴权）
- `PUT /api/nav`：更新导航数据（需要鉴权）
- `POST /api/login`：认证口令登录
- `POST /api/logout`：退出登录
- `GET /api/me`：验证当前认证口令

鉴权方式：
- `Authorization: Bearer <ADMIN_TOKEN>`
- 或 `X-Admin-Token: <ADMIN_TOKEN>`

请求体示例（推荐）：
```json
{
  "settings": {
    "title": "团队导航",
    "subtitle": "一站式访问常用资源",
    "announcement": "内外网开关会切换同一卡片的不同地址",
    "footerNote": "维护人：平台组",
    "defaultView": "external"
  },
  "groups": [
    {
      "title": "Tools",
      "items": [
        {
          "name": "Docs",
          "externalUrl": "https://example.com",
          "internalUrl": "http://docs.company.local",
          "imageUrl": "https://www.google.com/s2/favicons?domain=example.com&sz=128",
          "desc": "Reference"
        }
      ]
    }
  ]
}
```

更新示例：
```bash
curl -X PUT http://127.0.0.1:8787/api/nav \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"settings":{"title":"团队导航","subtitle":"一站式访问常用资源","announcement":"","footerNote":"","defaultView":"external"},"groups":[{"title":"Tools","items":[{"name":"Docs","externalUrl":"https://example.com","internalUrl":"","imageUrl":"","desc":""}]}]}'
```

登录示例：
```bash
curl -X POST http://127.0.0.1:8787/api/login \
  -H "Content-Type: application/json" \
  -d '{"token":"your_token"}'
```

## D1 Schema
迁移文件：`migrations/001_init.sql`
```sql
CREATE TABLE IF NOT EXISTS nav (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Notes
- 本项目使用静态资源绑定 `ASSETS` 提供 `web/dist`。
- 若需自定义路由或增加 API，请扩展 `src/index.ts`。
- 图标可存储在 R2，通过 `/icons/<key>` 访问。
- 当卡片选择“手动 URL”并填写 `http/https` 或 `data:image/*` 时，保存会自动写入 R2，并把 `imageUrl` 替换为 `/icons/<key>`。
