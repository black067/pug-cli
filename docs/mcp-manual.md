# pug-cli MCP 使用手册

`pug-cli` 内置 MCP (Model Context Protocol) 服务器，可作为 AI 编程助手的工具后端运行。

## 启动 MCP 服务器

### 从源码运行

```bash
node src/cli.js --mcp-server
```

### 使用打包版本

```bash
node dist/pug-cli-bundled.js --mcp-server
```

### VS Code / Cursor 配置

在用户级或项目级 `mcp.json` 中添加：

```json
{
  "mcpServers": {
    "pug-mcp": {
      "command": "node",
      "args": ["path/to/src/cli.js", "--mcp-server"]
    }
  }
}
```

---

## 工具列表

共 6 个工具，按功能分为三组：

| 工具 | 分组 | 说明 |
|------|------|------|
| `pug_to_html` | Pug 编译 | Pug → HTML，自动识别输入类型（内联/文件/glob/目录） |
| `pug_to_js` | Pug 编译 | Pug → 客户端 JavaScript 函数 |
| `html_to_pug` | 反向转换 | HTML/XML → Pug 语法 |
| `html_to_svg` | 图像渲染 | HTML → SVG（Satori 引擎） |
| `html_to_png` | 图像渲染 | HTML → PNG（Playwright 无头 Chromium） |
| `pug_to_png` | 图像渲染 | Pug → PNG 一步完成（Pug → HTML → PNG） |

---

## 工具详解

### 1. `pug_to_html` — Pug 编译为 HTML

输入自动识别逻辑：

| 输入形式 | 识别为 | 行为 |
|----------|--------|------|
| 文件路径（如 `src/page.pug`） | `file` | 读取文件内容并编译 |
| 目录路径（如 `src/templates`） | `directory` | 递归查找 `**/*.pug`，批量编译 |
| glob 模式（如 `src/**/*.pug`） | `glob` | 展开匹配文件，批量编译 |
| 其他字符串 | `inline` | 视为 Pug 源代码直接编译 |

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | `string` \| `string[]` | ✅ | Pug 源码 / 文件路径 / glob / 目录。支持数组传入多个 |
| `output` | `string` | — | 输出目录。提供时将编译结果写入磁盘文件，不提供时返回内联 HTML |
| `pretty` | `boolean` | — | 美化 HTML 输出（缩进和换行） |
| `locals` | `object` | — | 模板变量，如 `{"title": "Hello"}` |
| `filename` | `string` | — | 虚拟文件名（用于错误栈追踪）。内联源码使用 `extends`/`include` 时必填 |
| `basedir` | `string` | — | 路径解析根目录。`include`/`extends` 的相对路径以此为基础解析。默认：文件模式 = 文件所在目录，内联模式 = 当前工作目录 |

**返回格式：**

- 单文件 / 单内联源码 → 直接返回 HTML 字符串
- 多文件 / 多内联源码 → 返回 `{key: html, ...}` JSON 字典
- 使用 `output` 参数时 → 返回 `{written, failed, files: [{input, output}]}` JSON 摘要

---

### 2. `pug_to_js` — Pug 编译为 JS 函数

调用 `pug.compileClient()` 生成客户端 JavaScript 函数。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | `string` | ✅ | Pug 源码或 `.pug` 文件路径（自动检测：文件存在 → 读取，否则 → 视为内联源码） |
| `name` | `string` | — | JavaScript 函数名，默认 `"template"` |
| `module` | `boolean` | — | 包装为 CommonJS `module.exports`（用于 Node.js） |
| `filename` | `string` | — | 虚拟文件名（用于错误栈追踪） |
| `basedir` | `string` | — | 路径解析根目录。默认：文件所在目录，或当前工作目录 |

**返回：** JavaScript 源码字符串。

---

### 3. `html_to_pug` — HTML/XML 转 Pug

反向转换，自动识别模式：
- 含 `<!DOCTYPE html>` 或 `<html>` → **HTML 模式**（`#id`、`.class` 简写，布尔属性）
- 否则 → **XML 模式**（保留命名空间、CDATA、属性完整语法）

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | `string` | ✅ | HTML/XML 源码或文件路径（自动检测） |

**返回：** Pug 源码字符串。

**特性：**
- `doctype html` / `doctype xml` 正确转换
- `script` / `style` / `pre` / `textarea` 内容使用 `.` 点号块保留原样
- HTML 内联混合内容（如 `<p>hello <b>world</b></p>`）生成 `| ` 管道文本
- CDATA 保留为 `<![CDATA[...]]>`
- 标准 XML 声明（`version="1.0" encoding="utf-8"`）→ `doctype xml`

---

### 4. `html_to_svg` — HTML 渲染为 SVG

通过 Vercel Satori 引擎渲染 HTML 为矢量 SVG。支持 Flexbox CSS 布局。

**⚠️ 注意：** Satori 仅支持 Flexbox 布局子集，不支持 CSS Grid、`position: absolute` 等。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | `string` | ✅ | HTML 源码或文件路径（自动检测） |
| `width` | `number` | — | SVG 画布宽度（像素）。省略时自动从 HTML `style="width:..."` 检测 → 默认 800 |
| `height` | `number` | — | SVG 画布高度（像素）。省略时自动从 HTML `style="height:..."` 检测 → 默认 600 |
| `fonts` | `string[]` | — | 额外字体文件路径（TTF/OTF/WOFF）。内置 Inter（拉丁）+ Noto Sans SC（中日韩） |
| `debug` | `boolean` | — | 绘制布局边界框，用于调试 |
| `basedir` | `string` | — | CSS 路径解析根目录。`<link href="...">` 的相对路径以此为基础解析并自动内联 |
| `css` | `string` | — | **推荐方式**：直接传入 CSS 字符串，自动注入为内联 `<style>` 标签。无需文件路径 |

**返回：** SVG 字符串。

**CSS 处理：**
- `<link rel="stylesheet" href="...">` 标签会自动相对于 `basedir`（或 CWD）解析，找到文件后内联为 `<style>`
- 未找到的文件保留原 `<link>` 标签并标记 `data-pug-cli-warn` 属性
- 使用 `css` 参数可直接传入 CSS 字符串，完全避开路径问题（**推荐 Agent 使用**）

**内置功能：**
- Emoji 自动转换为彩色图片（从 Twemoji CDN 获取）
- 画布尺寸自动检测（从 HTML 内联样式 `width`/`height` 属性提取）

---

### 5. `html_to_png` — HTML 渲染为 PNG

通过 Playwright 无头 Chromium 渲染 HTML 为 PNG 图片。**`output` 为必填参数**，PNG 始终写入磁盘。

- `output` 指定输出路径 → PNG 写入磁盘
- 设 `returnBase64: true` → 同时返回 base64 data URI（默认不返回）

**⚠️ 需要系统安装 Chrome / Edge / Chromium。** 若未检测到浏览器则报错。

**参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `source` | `string` | ✅ | — | HTML 源码或文件路径（自动检测） |
| `output` | `string` | ✅ | — | **必填。** 输出文件路径（如 `"output.png"` 或 `"dist/result.png"`），PNG 写入磁盘并持久保留 |
| `returnBase64` | `boolean` | — | false | 同时返回 base64 data URI（用于内联预览）。默认仅返回写入确认 |
| `width` | `number` | — | 自动检测 → 800 | 视口宽度（像素） |
| `height` | `number` | — | 自动检测 → 600 | 视口高度（像素） |
| `scale` | `number` | — | 2 | 设备缩放因子（Retina） |
| `autoCrop` | `boolean` | — | false | 自动裁剪到 `<body>` 内容边界框 |
| `fullPage` | `boolean` | — | true（配置） | 截取完整可滚动页面，设为 false 则限制为视口 |
| `browserPath` | `string` | — | 自动检测 | 指定浏览器可执行文件路径 |
| `basedir` | `string` | — | CWD | CSS 路径解析根目录。`<link href="...">` 的相对路径以此为基础解析并自动内联 |
| `css` | `string` | — | — | **推荐方式**：直接传入 CSS 字符串，自动注入为内联 `<style>` 标签 |

**返回：** `{"written": "<output路径>"}` 文本确认。若 `returnBase64: true`，额外附带 `resource` 类型内容含 `data:image/png;base64,...`。

**浏览器检测优先级：**
1. `browserPath` 参数显式指定
2. `CHROME_PATH` / `BROWSER_PATH` 环境变量
3. Playwright channel 检测（chrome → msedge → chromium）
4. Playwright 托管浏览器（`npx playwright install chromium` 安装的）
5. `pug-cli.config.json` 中 `browser.searchPaths`

**HTML 片段处理：** 不含 `<html>` 标签的片段会自动包装为完整文档（含 CSS reset），包装 CSS 可通过 `pug-cli.config.json` 的 `png.wrapperCss` 自定义。

---

### 6. `pug_to_png` — Pug 一步渲染为 PNG

`pug_to_html` + `html_to_png` 的组合。接受 Pug 源码，内部自动编译为 HTML 再渲染为 PNG。**`output` 为必填参数**，PNG 始终写入磁盘。

- `output` 指定输出路径 → PNG 写入磁盘
- 设 `returnBase64: true` → 同时返回 base64 data URI（默认不返回）

**参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `source` | `string` | ✅ | — | Pug 源码或 `.pug` 文件路径（自动检测） |
| `output` | `string` | ✅ | — | **必填。** 输出文件路径（如 `"output.png"` 或 `"dist/result.png"`），PNG 写入磁盘并持久保留 |
| `returnBase64` | `boolean` | — | false | 同时返回 base64 data URI（用于内联预览）。默认仅返回写入确认 |
| `filename` | `string` | — | — | Pug 虚拟文件名（使用 `extends`/`include` 时必填） |
| `pretty` | `boolean` | — | false | 美化中间 HTML 输出 |
| `doctype` | `string` | — | — | 覆盖 doctype |
| `locals` | `object` | — | — | 模板变量 |
| `basedir` | `string` | — | — | 路径解析根目录。同时影响 Pug `include`/`extends` 和 CSS `<link>` 解析 |
| `css` | `string` | — | — | **推荐方式**：直接传入 CSS 字符串，自动注入为内联 `<style>` 标签 |
| `width` | `number` | — | 自动检测 → 800 | 视口宽度 |
| `height` | `number` | — | 自动检测 → 600 | 视口高度 |
| `scale` | `number` | — | 2 | 设备缩放因子 |
| `autoCrop` | `boolean` | — | false | 自动裁剪 |
| `fullPage` | `boolean` | — | true | 全页截图 |
| `browserPath` | `string` | — | 自动检测 | 浏览器路径 |

**返回：** `{"written": "<output路径>"}` 文本确认。若 `returnBase64: true`，额外附带 `resource` 类型内容含 `data:image/png;base64,...`。

**浏览器不可用时的行为：** 与 `html_to_png` 不同，`pug_to_png` 在浏览器不可用时**不会直接报错**，而是：
1. 将编译后的中间 HTML 保存到系统临时目录
2. 返回错误消息，包含中间 HTML 文件路径和完整 HTML 内容
3. 用户可据此手动检查渲染结果

---

## 配置文件

MCP 模式同样读取 `pug-cli.config.json`（查找顺序：`./pug-cli.config.json` → `~/.pug-cli/config.json`），影响以下行为：

- `defaults.width` / `defaults.height` / `defaults.scale` / `defaults.fullPage` — PNG/SVG 默认参数
- `browser.searchPaths` — 额外的浏览器搜索路径
- `browser.launchArgs` — 浏览器启动参数
- `png.wrapperCss` — HTML 片段包装 CSS

---

## 路径解析约定

### 核心原则

**所有路径都相对于 `basedir` 书写，不使用绝对路径。** 绝对路径在目标机器上通常不存在，会导致解析失败。

### `basedir` 的默认值

| 场景 | 默认 `basedir` |
|------|---------------|
| 编译 `.pug` 文件 | 文件所在目录 |
| 内联 Pug 源码（未指定 `filename`） | 当前工作目录（CWD） |
| 内联 Pug 源码（指定了 `filename`） | `filename` 所在目录 |
| 显式传入 `basedir` 参数 | 使用传入值（覆盖默认） |

### CSS 路径解析

对于 `html_to_svg`、`html_to_png`、`pug_to_png`，HTML 中的 `<link rel="stylesheet" href="...">` 标签会：

1. 跳过 `http://` / `https://` 开头的绝对 URL
2. 将 `href` 相对于 `basedir`（或 CWD）解析为绝对路径
3. 如果文件存在 → 读取内容，将 `<link>` 替换为 `<style>/* 内容 */</style>`
4. 如果文件不存在 → 保留原 `<link>` 并添加 `data-pug-cli-warn="not found: ..."` 属性

### Agent 最佳实践

**🎯 首选：使用 `css` 参数**

```json
{
  "source": "<div style=\"display:flex\">Hello</div>",
  "css": "body { background: #f0f0f0; } div { color: red; }"
}
```

直接传 CSS 字符串，零路径依赖，最高效。

**📁 备选：相对 `basedir` 引用文件**

```json
{
  "source": "doctype html\nhtml\n  head\n    link(rel='stylesheet', href='styles/main.css')\n  body\n    h1 Hello",
  "basedir": "/path/to/project"
}
```

工具会自动将 `styles/main.css` 解析为 `/path/to/project/styles/main.css` 并内联。

**✅ Pug `include` / `extends` 的正确方式：**

```json
{
  "source": "extends layout.pug\nblock content\n  h1 hello",
  "filename": "templates/index.pug",
  "basedir": "/path/to/project"
}
```

---

## 使用建议

### Pug → SVG 的正确方式

`pug_to_svg` 不是独立的 tool。分两步：

1. 用 `pug_to_html` 将 Pug 编译为 HTML
2. 将返回的 HTML 传给 `html_to_svg`

### 批量文件编译

传入数组或 glob 即可：

```json
{
  "source": ["src/templates/*.pug"],
  "output": "dist/",
  "pretty": true
}
```
