# pug-cli CLI 使用手册

`pug-cli` 是一个命令行工具，提供 Pug 模板编译、HTML/XML 反向转换、SVG/PNG 图像渲染等能力。

## 基本语法

```
pug-cli [options] <file.pug ...>
```

或使用 Node.js 直接运行源码：

```bash
node src/cli.js [options] <file.pug ...>
```

> **提示**：本文档仅覆盖 CLI 模式。MCP Server 模式参见 [MCP 使用手册](mcp-manual.md)。

---

## 信息类选项

| 选项 | 行为 |
|------|------|
| `-h, --help` | 打印帮助信息并退出 |
| `-V, --version` | 打印版本信息（包含 pug-cli 版本和底层 pug 版本） |
| `--licence` | 打印 MIT 许可证全文 |
| `--config-gen` | 在当前目录生成 `pug-cli.config.json` 配置模板。若文件已存在则报错退出 |
| `--mcp-server` | 启动 MCP 服务器模式（stdio 传输），供 AI 编程助手调用 |

---

## I/O 模式

### 普通编译（默认）

```bash
pug-cli file1.pug file2.pug -o output/
```

将 `.pug` 文件编译为 HTML，写入 `-o` 指定的输出目录。输出文件名为 `<原名>.html`。

- 支持一次传入多个文件。
- 如果输出目录不存在，会自动创建。

### 反向转换 `-R, --reverse`

```bash
pug-cli page.html -o output/ --reverse
```

将 HTML 或 XML 文件转换为 Pug 语法。模式自动识别：
- 检测到 `<!DOCTYPE html>` 或 `<html>` 标签 → **HTML 模式**（使用 `#id`、`.class` 简写，布尔属性省略值）
- 否则 → **XML 模式**（保留命名空间、CDATA、属性完整语法）

输出文件名为 `<原名>.pug`。

### SVG 渲染 `-S, --to-svg`

```bash
pug-cli card.pug -o output/ --to-svg --width 400 --height 200
pug-cli page.html -o output/ --to-svg
```

将 `.pug` 或 `.html` 文件渲染为 SVG（通过 Vercel Satori 引擎）。流程：
- `.pug` 文件 → 先编译为 HTML → 再渲染 SVG
- `.html` 文件 → 直接渲染 SVG

输出文件名为 `<原名>.svg`。

### PNG 渲染 `-P, --to-png`

```bash
pug-cli card.pug -o output/ --to-png --width 400 --height 200
pug-cli page.html -o output/ --to-png
```

将 `.pug` 或 `.html` 文件渲染为 PNG（通过 Playwright 无头 Chromium）。流程同上。

**⚠️ 需要系统安装 Chrome / Edge / Chromium。** 若未检测到浏览器则直接报错退出。

输出文件名为 `<原名>.png`。

### 标准输入 `--stdin`

```bash
echo "h1 hello" | pug-cli --stdin
```

从标准输入读取 Pug 模板，编译后的 HTML 直接输出到标准输出。

- 不能与 `--watch` 同时使用。
- 不支持文件输出（结果始终打印到 stdout）。

### 监听模式 `-w, --watch`

```bash
pug-cli file.pug -o output/ --watch
```

监听文件变化，变化时自动重新编译。行为：
1. 立即执行一次全量编译
2. 使用 `fs.watch` 监听每个文件（带 100ms 防抖）
3. 按 `Ctrl+C` 停止

---

## 编译选项

所有编译选项直接映射到 Pug 原生 API。

| 选项 | 对应 Pug 选项 | 说明 |
|------|--------------|------|
| `-p, --pretty` | `pretty: true` | 美化 HTML 输出（缩进和换行） |
| `-D, --no-debug` | `compileDebug: false` | 禁用编译调试信息（默认开启） |
| `-d, --doctype <str>` | `doctype` | 覆盖 doctype。可选值：`html`、`xml`、`transitional` 等 |
| `-g, --global <name>` | `globals` | 声明全局变量。可重复使用多次 |
| `-s, --self` | `self: true` | 使用 `self` 命名空间访问 locals |
| `-C, --cache` | `cache: true` | 启用模板缓存 |

### 模板变量 `-O, --obj`

```bash
# JSON 字符串
pug-cli file.pug -o output/ -O '{"title":"Hello","items":[1,2,3]}'

# JSON 文件路径（自动检测：文件存在则读文件，否则解析为 JSON 字面量）
pug-cli file.pug -o output/ -O data.json
```

### 客户端 JS 编译

| 选项 | 行为 |
|------|------|
| `-c, --client` | 编译为客户端 JavaScript 函数（调用 `pug.compileClient`） |
| `-M, --module` | 包装为 CommonJS `module.exports`（需与 `--client` 一起使用） |
| `-n, --name <str>` | 指定模板函数名（默认 `"template"`） |

```bash
# 编译为独立 JS 函数
pug-cli file.pug -o output/ --client

# 带模块导出和自定义函数名
pug-cli file.pug -o output/ --client --module --name myTemplate
```

### 扩展性

| 选项 | 行为 |
|------|------|
| `-f, --filter <name=mod>` | 注册一个 Pug filter。格式：`name=module`，如 `md=jstransformer-markdown-it` |
| `--plugin <module>` | 加载一个 Pug 插件模块。可重复使用多次 |

---

## 图像输出选项

以下选项适用于 `--to-svg` 和 `--to-png` 模式。

| 选项 | 适用模式 | 默认值 | 说明 |
|------|---------|--------|------|
| `--width <n>` | SVG / PNG | 自动检测 → 800 | 画布/视口宽度（像素）。优先从 HTML 内联样式中自动检测 |
| `--height <n>` | SVG / PNG | 自动检测 → 600 | 画布/视口高度（像素）。优先从 HTML 内联样式中自动检测 |
| `--font <path>` | 仅 SVG | — | 加载额外字体文件（TTF/OTF/WOFF）。可重复使用多次。内置 Inter（拉丁）+ Noto Sans SC（中日韩） |

### PNG 专属选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `-B, --browser <path>` | 自动检测 | 指定浏览器可执行文件路径 |
| `--scale <n>` | 2 | 设备缩放因子（Retina）。值为 1 时不缩放 |
| `--auto-crop` | false | 自动裁剪到内容边界框 |
| `--full-page` | 由配置决定 | 截取完整可滚动页面。配置文件默认开启（`fullPage: true`） |

---

## 配置文件

运行 `pug-cli --config-gen` 可生成配置模板 `pug-cli.config.json`：

```json
{
  "browser": {
    "searchPaths": ["D:\\MyTools\\chrome.exe"],
    "launchArgs": ["--no-sandbox"]
  },
  "defaults": {
    "width": 1200,
    "height": 800,
    "scale": 1,
    "fullPage": true
  },
  "png": {
    "wrapperCss": "*{margin:0;padding:0;box-sizing:border-box}..."
  }
}
```

配置查找顺序（先找到的生效）：
1. `./pug-cli.config.json`（当前工作目录）
2. `~/.pug-cli/config.json`（用户主目录）

---

## 完整示例

```bash
# 基础编译
pug-cli src/index.pug -o dist/ --pretty -O '{"title":"My Site"}'

# 监听模式 + 美化
pug-cli src/index.pug -o dist/ --pretty --watch

# 客户端 JS 编译
pug-cli src/template.pug -o dist/ --client --module --name renderCard

# HTML 转 Pug
pug-cli page.html -o src/ --reverse

# Pug 渲染为 SVG（带自定义字体）
pug-cli card.pug -o dist/ --to-svg --width 390 --height 844 --font ./fonts/PingFang.ttf

# HTML 渲染为 PNG（Retina + 裁剪）
pug-cli page.html -o dist/ --to-png --width 1200 --scale 2 --auto-crop

# 管道输入
cat template.pug | pug-cli --stdin --pretty
```
