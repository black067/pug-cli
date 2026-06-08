# CLI 使用参考

`pug-cli` 是对 [Pug 模板引擎](https://pugjs.org/) 的命令行封装，支持编译、反转、图片渲染等多种模式。

## 快速使用

```bash
pug-cli <file.pug ...> [options]

# 编译为 HTML
pug-cli input.pug -o output/

# 编译为客户端 JS 函数
pug-cli input.pug --client -n myTemplate

# 从 stdin 读取
pug-cli --stdin < input.pug
```

## 选项

### 编译选项

| 参数 | 简写 | 说明 |
|------|------|------|
| `--out <dir>` | `-o` | 输出目录（默认当前目录） |
| `--pretty` | `-p` | 美化 HTML 输出 |
| `--obj <str>` | `-O` | JSON 字符串或文件路径，传递模板变量 |
| `--no-debug` | `-D` | 关闭编译调试信息 |
| `--doctype <str>` | `-d` | 覆写 doctype（html, xml, transitional 等） |
| `--global <name>` | `-g` | 声明全局变量（可重复） |
| `--self` | `-s` | 使用 self 命名空间传递 locals |
| `--cache` | `-C` | 启用模板缓存 |

### 客户端 JS 编译

| 参数 | 简写 | 说明 |
|------|------|------|
| `--client` | `-c` | 编译为客户端 JS 函数 |
| `--module` | `-M` | 包装为 CommonJS `module.exports`（需配合 `--client`） |
| `--name <str>` | `-n` | 模板函数名（默认 "template"） |

### 扩展性

| 参数 | 简写 | 说明 |
|------|------|------|
| `--filter <name=mod>` | `-f` | 注册过滤器（如 `md=jstransformer-markdown-it`） |
| `--plugin <module>` | | 加载 Pug 插件模块（可重复） |

### 图片输出

| 参数 | 说明 | 详见 |
|------|------|------|
| `--to-svg` / `-S` | 转换为 SVG | [docs/svg.md](svg.md) |
| `--to-png` / `-P` | 转换为 PNG | [docs/png.md](png.md) |
| `--width <n>` | 画布/视口宽度（像素，默认 800） | |
| `--height <n>` | 画布/视口高度（像素，默认 600） | |
| `--font <path>` | 加载额外字体（SVG 时有效，可重复） | |

### I/O 模式

| 参数 | 简写 | 说明 |
|------|------|------|
| `--watch` | `-w` | 监视文件变化并自动重编译 |
| `--stdin` | | 从标准输入读取模板 |
| `--reverse` | `-R` | 将 HTML/XML 反转为 Pug 语法 |
| `--mcp-server` | | 启动 MCP (Model Context Protocol) 服务器 |

### 其他

| 参数 | 简写 | 说明 |
|------|------|------|
| `--help` | `-h` | 显示帮助信息 |
| `--version` | `-V` | 显示版本信息 |
| `--licence` | | 显示许可证信息 |

## MCP 支持

`pug-cli` 可作为 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) Server 运行：

```bash
pug-cli --mcp-server
```

### 可用工具

| 工具 | 说明 |
|------|------|
| `pug_to_html` | Pug → HTML 编译 |
| `pug_to_js` | Pug → 客户端 JS 函数 |
| `html_to_pug` | HTML/XML → Pug 语法转换 |
| `html_to_svg` | HTML → SVG 渲染（Satori） |
| `html_to_png` | HTML → PNG 渲染（Playwright） |

### VS Code 配置示例

在 `.vscode/mcp.json` 中添加：

```json
{
  "servers": {
    "pug": {
      "type": "stdio",
      "command": "node",
      "args": ["<bundledjsPathHere>", "--mcp-server"]
    }
  }
}
```

或使用 SEA 可执行文件：

```json
{
  "servers": {
    "pug": {
      "type": "stdio",
      "command": "<pathToExe>",
      "args": ["--mcp-server"]
    }
  }
}
```
