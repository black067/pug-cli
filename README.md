# pug-cli

一个对 [Pug 模板引擎](https://pugjs.org/) 的简单命令行封装，支持将 `.pug` 文件编译为 HTML 或 JavaScript 模板函数。

## 做了什么

本项目本质上只是对 `pug` 库做了一层 CLI 封装，然后通过 **esbuild** 将所有依赖打包成单个 JS 文件，再用 Node.js **SEA (Single Executable Application)** 机制生成独立的 `.exe` 可执行文件，方便在没有 Node.js 环境的机器上直接使用。

## 使用方式

```bash
# 安装 pug 后可全局调用
pug <input.pug> [options]

# 或者直接使用打包后的可执行文件
./dist/pug.exe <input.pug> [options]
```

## 构建

```bash
npm run build     # 打包 JS + 构建 SEA 可执行文件 (pug.exe)
npm run bundle    # 仅打包 JS
npm run sea       # 仅构建 SEA 可执行文件
```

## MCP 支持

本项目提供独立的 **pug-mcp.exe**，可作为 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) Server 运行，让 AI Agent 直接调用 Pug 编译能力。

下载: [Releases](https://github.com/black067/pug-cli/releases)

### 构建

```bash
npm run build:mcp   # 打包 JS + 构建 SEA 可执行文件 (pug-mcp.exe)
npm run bundle:mcp  # 仅打包 JS
npm run sea:mcp     # 仅构建 SEA 可执行文件
```

### 在 VS Code 中配置

在项目或用户级 `.vscode/mcp.json` 中添加：

**方式一：Node.js 直接运行（开发时使用，无需构建）**

```json
{
  "servers": {
    "pug": {
      "type": "stdio",
      "command": "node",
      "args": ["<put your pug-mcp-bundled.js path here>"]
    }
  }
}
```

**方式二：独立可执行文件（发布/分发场景）**

```json
{
  "servers": {
    "pug": {
      "type": "stdio",
      "command": "<put your pug-mcp path here>",
      "args": []
    }
  }
}
```
