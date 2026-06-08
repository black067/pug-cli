# pug-cli

一个对 [Pug 模板引擎](https://pugjs.org/) 的命令行封装，支持编译 HTML、客户端 JS 函数、SVG 及 PNG 渲染。

**做了什么**

本项目对 `pug` 库做 CLI 封装，通过 **esbuild** 将所有依赖打包成单 JS 文件，再用 Node.js **SEA** 生成独立可执行文件，无需 Node.js 环境即可运行。

## 下载

[Releases](https://github.com/black067/pug-cli/releases)

## 快速开始

```bash
# Pug → HTML
pug-cli input.pug -o output/

# Pug → SVG
pug-cli input.pug --to-svg --width 400 --height 800

# HTML → Pug（反转）
pug-cli input.html --reverse

# Pug → PNG（需系统有 Chrome/Edge）
pug-cli input.pug --to-png --width 800 --height 600

# 启动 MCP 服务器
pug-cli --mcp-server
```

## 参考文档

| 文档 | 说明 |
|------|------|
| [CLI 使用参考](docs/cli.md) | 所有选项、MCP 配置、构建方式 |
| [SVG 输出](docs/svg.md) | Satori 引擎、字体管理、Emoji、编程 API |
| [PNG 输出](docs/png.md) | Playwright 渲染、浏览器检测、降级策略 |

## 构建

```bash
npm run build     # 打包 JS + 构建 SEA 可执行文件
npm run bundle    # 仅打包 JS
npm run sea       # 仅构建 SEA 可执行文件
```

> `npm run bundle` 不包含 `playwright-core`（含原生二进制），如需 `--to-png` 请通过 `node src/cli.js` 运行。

## MCP 支持

可作为 [MCP Server](https://modelcontextprotocol.io/) 运行，提供 Pug 编译、HTML 反转、SVG/PNG 渲染等工具。详见 [CLI 参考 > MCP 支持](docs/cli.md#mcp-支持)。

### VS Code 配置

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
