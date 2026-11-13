# IndexNow 安装包（2026-11-12 修复版）

适用于 ShipAny TanStack 项目。安装后后台提供 `/admin/indexnow`，可以保存密钥、检查根目录验证文件、提交 sitemap 或指定页面。

新版模板已经内置此功能，不需要重复安装。旧项目可使用此包升级。

## 这次修复

- 密钥直接读写数据库，不再走通用设置接口。旧包遇到新版模板的 `indexnow_key` 保护规则时，会出现“保存成功但实际没有写入”的问题；配置缓存也可能使验证文件继续返回旧密钥。升级后兼容旧版加密保存的密钥，原有 `CONFIG_ENCRYPTION_KEY` 需要保留。
- 线上域名优先读取服务器的 `VITE_APP_URL`（Cloudflare 运行时绑定优先），避免本地构建的 localhost 混入 keyLocation、提交 host 和 sitemap。
- 保留统一管理接口、专属权限和审计；旧模板使用独立接口，仍检查登录、专属权限、同源请求、限流、输入大小和 URL。
- 提交有超时和备用端点，不再无限等待；服务端只提交本站 HTTP(S) URL，不接受其他网站的网址。
- 页面展示实际使用的网站地址。验证文件通过后才能提交；跨域后台会明确提示打开正确域名。搜索引擎返回的失败状态会显示出来。
- `sync.mjs` 现在接受源项目路径，移动安装包后仍可更新，不再固定依赖 hotel lobby 的目录位置。

## 升级旧项目

```bash
node /完整路径/indexnow-installer/install.mjs /完整路径/你的项目 --force
cd /完整路径/你的项目
pnpm build
```

程序会先备份被覆盖的文件到目标项目的 `.indexnow-backup-时间戳/`，保留已保存的密钥和已有文案。支持统一 IndexNow 管理操作的模板自动使用统一接口；其他兼容模板使用独立接口。

模板需要有 `src/core/db`、`src/config/db/schema.ts`、RBAC、`useUserPermissions`、`rate-limit`、TanStack Form、Paraglide 和 shadcn 表单组件。先按目标项目流程完成依赖安装和数据库初始化。安装器会在缺少必需文件时停止。

## 部署与使用

1. 将服务器 `VITE_APP_URL` 设置为网站实际公网地址，例如 `https://example.com`。Cloudflare 配置在 `wrangler.jsonc` 的 `vars` 中；构建环境也建议保持相同值。本地预览不能向外部搜索引擎提交。
2. 部署更新后的代码，打开 `/admin/indexnow`。超级管理员可直接操作。其他角色需要 `admin.indexnow.read`、`admin.indexnow.write`、`admin.indexnow.submit`；新版模板可运行 `pnpm admin:token sync-permissions` 登记权限，再在后台授予角色。
3. 保存一个 8–128 位、由字母、数字和短横线组成的密钥。可以使用 Bing 提供的密钥，也可自行生成符合规则的随机密钥。
4. 确认 `https://你的域名/密钥.txt` 返回纯文本密钥，且无需登录；在页面点“重新检测”。
5. 提交 sitemap 或指定页面，每次最多 10,000 个 URL。200 表示收到，202 表示收到并等待密钥验证，都不保证索引收录。403 应检查密钥文件；422 应检查网址和 host 是否一致；429 请稍后重试。

不要直接向 `config` 通用设置写 `indexnow_key`。安装包无需新表；密钥仍存储在原有 config 表中。

## 更新安装包

```bash
node /完整路径/indexnow-installer/sync.mjs /完整路径/shipany-tanstack-main
```

独立旧模板 API 适配器单独维护；`sync.mjs` 同步业务模块、浏览器辅助文件、现代 API 适配器和英文文案。安装包跟随模板，仅提供英文界面文案。

修复包不提供文件级卸载，避免删除文件后留下损坏的管理操作或 sitemap 导入。需要撤销升级时，使用备份或 Git 恢复。
