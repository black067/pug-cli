# pug-cli CLI 使用手册

`pug-cli` 支持 Pug 模板编译、HTML/XML 反向转换、SVG/PNG 图像渲染。

> **提示**：本文档聚焦**使用场景与最佳实践**。完整的选项列表（参数名、类型、默认值）请直接运行 `pug-cli --help`。  
> MCP Server 模式参见 [MCP 使用手册](mcp-manual.md)。

---

## 基本语法

```
pug-cli [options] <file.pug ...>
```

---

## 使用场景

### 场景 1：编译 Pug 为 HTML

```bash
# 基本编译
pug-cli src/index.pug -o dist/

# 传模板变量（自动识别：文件路径 vs JSON 字面量）
pug-cli src/index.pug -o dist/ -O '{"title":"Hello"}'
pug-cli src/index.pug -o dist/ -O data.json

# 美化输出
pug-cli src/index.pug -o dist/ --pretty

# 批量编译
pug-cli src/page1.pug src/page2.pug -o dist/
```

**注意**：
- `-o` 在单文件时作为输出**文件路径**；多文件时作为输出**目录**，文件名自动取 `<原名>.html`。
- `--basedir` 控制 `include`/`extends` 路径解析根目录（默认：文件所在目录）。

### 场景 2：编译为客户端 JS 函数

```bash
# 编译为独立 JS 函数
pug-cli src/template.pug -o dist/ --client

# 包一层 module.exports，指定函数名
pug-cli src/template.pug -o dist/ --client --module --name renderCard
```

**注意**：`--module` 必须与 `--client` 搭配使用。

### 场景 3：HTML/XML 反向转为 Pug

```bash
pug-cli page.html -o src/ --reverse
```

工具自动识别模式：
- 检测到 `<!DOCTYPE html>` 或 `<html>` 标签 → **HTML 模式**（使用 `#id`、`.class` 简写，布尔属性省略值）
- 否则 → **XML 模式**（保留命名空间、CDATA、属性完整语法）

输出文件名为 `<原名>.pug`。

### 场景 4：渲染为 SVG（卡片/封面/海报）

```bash
# Pug → HTML → SVG
pug-cli card.pug -o dist/ --to-svg --width 390 --height 844

# HTML → SVG（跳过 Pug 编译）
pug-cli page.html -o dist/ --to-svg

# 带自定义字体（支持 TTF/OTF/WOFF，可重复）
pug-cli card.pug -o dist/ --to-svg --fonts ./fonts/PingFang.ttf
```

**流程**：`.pug` 文件 → Pug 编译为 HTML → Satori 引擎渲染 SVG。

**字体**：内置 Inter（拉丁）和 Noto Sans SC（中日韩）。额外字体用 `--fonts` 加载。

**宽高检测**：`--width`/`--height` 未指定时，优先从 HTML 内联样式中自动检测，否则回退到 800×600。

### 场景 5：渲染为 PNG（截图/封面/OG 图）

```bash
# Pug → HTML → PNG
pug-cli card.pug -o dist/ --to-png --width 1200

# HTML → PNG
pug-cli page.html -o dist/ --to-png

# Retina 缩放 + 自动裁剪
pug-cli card.pug -o dist/ --to-png --scale 2 --auto-crop

# 指定浏览器路径
pug-cli card.pug -o dist/ --to-png --browser "C:\Program Files\Chromium\chrome.exe"
```

**⚠️ 需要 Chrome / Edge / Chromium。** 可用 `--browser` 指定路径或设置 `CHROME_PATH` 环境变量。

**注意**：
- 默认 `--scale 2`（Retina），值为 1 时像素级对应。
- 浏览器搜索路径和启动参数详见[配置文件](#配置文件)。
- `--width`/`--height` 未指定时自动检测逻辑同 SVG。

### 场景 6：管道/CI 使用

```bash
echo "h1 #{title}" | pug-cli --stdin -O '{"title":"Hello"}'
cat template.pug | pug-cli --stdin --pretty
```

### 场景 7：监听模式（开发时实时编译）

```bash
pug-cli src/index.pug -o dist/ --watch
```

执行后立即编译一次，然后监听文件变化自动重新编译（100ms 防抖），按 `Ctrl+C` 停止。

---

## 配置文件

运行 `pug-cli --config-gen` 生成 `pug-cli.config.json` 模板。

查找顺序（先找到的生效）：
1. `./pug-cli.config.json`（当前工作目录）
2. `~/.pug-cli/config.json`（用户主目录）

| 配置路径 | 用途 | CLI 对应 |
|----------|------|----------|
| `browser.searchPaths` | 浏览器搜索路径（数组） | `--browser` |
| `browser.launchArgs` | 浏览器启动参数 | — |
| `defaults.width` | 图像默认宽度 | `--width` |
| `defaults.height` | 图像默认高度 | `--height` |
| `defaults.scale` | PNG 默认缩放 | `--scale` |
| `defaults.fullPage` | PNG 是否截取完整可滚动页面 | **仅配置文件** |
| `png.wrapperCss` | PNG 渲染时注入的包装 CSS | **仅配置文件** |

---

## 常见问题与调试

### 浏览器检测失败

```
Error: No Chromium browser detected.
```

排查步骤：
1. 安装 Chrome / Edge / Chromium
2. 用 `--browser <path>` 显式指定路径
3. 设置 `CHROME_PATH` 环境变量
4. 在配置文件的 `browser.searchPaths` 中添加路径

使用 `--browser-detect` 可查看所有搜索路径的诊断详情。

### include/extends 路径解析失败

```
the "basedir" option is required to use includes and extends with "absolute" paths
```

- 使用 `--basedir <dir>` 设置正确的根目录
- 默认 basedir 为输入文件所在目录
- 绝对路径的 include/extends 必须指定 `--basedir`

### 字体加载失败（SVG 模式）

- 确认字体文件路径正确（使用 `--fonts ./path/to/font.ttf`）
- 支持 TTF / OTF / WOFF 格式
- 内置 Inter + Noto Sans SC，仅在这些字体覆盖不足时需要自定义字体