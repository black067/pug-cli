# pug-cli MCP 使用手册

`pug-cli` 内置 MCP 服务器，提供 6 个工具（Pug 编译、HTML/XML 转换、SVG/PNG 渲染）。Agent 连接后自动获取工具说明和参数详情。

## 启动

```bash
# 从源码
node src/cli.js --mcp-server

# 打包版本
node dist/pug-cli-bundled.js --mcp-server
```

## 编辑器配置

用户级或项目级 `mcp.json`：

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

## 系统要求

- **PNG 渲染**（`html_to_png`、`pug_to_png`）：需要系统安装 Chrome / Edge / Chromium，未检测到时保存中间 HTML 到临时目录并报错
- **SVG 渲染**（`html_to_svg`）：内置 Inter + Noto Sans SC 字体，支持额外 TTF/OTF/WOFF 字体

## 配置文件

可选 `pug-cli.config.json`（项目目录或 `~/.pug-cli/config.json`），可配置：

| 配置项 | 作用 |
|--------|------|
| `defaults.width / height / scale / fullPage` | PNG/SVG 默认参数 |
| `browser.searchPaths / launchArgs` | 浏览器搜索路径和启动参数 |
| `png.wrapperCss` | HTML 片段包装样式 |

## 调试

`--debug` 必须与 `--mcp-server` 配合使用。开启后：

- 所有工具调用时在 stderr 输出详细调试日志（工具名、输入源、编译进度、耗时等）
- 工具执行出错时在 stderr 输出完整 JavaScript 调用栈
- SVG 渲染（`html_to_svg`）额外绘制 Satori 布局边界框
- PNG 渲染输出浏览器检测状态和截图路径

```bash
node src/cli.js --mcp-server --debug
```
