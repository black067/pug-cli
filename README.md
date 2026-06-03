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

本项目提供独立的 **pug-mcp** (`js` / `SEA`)，可作为 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) Server 运行，让 AI Agent 直接调用 Pug 编译能力。

### Download

下载: [Releases](https://github.com/black067/pug-cli/releases)

#### 校验下载文件

每个 Release 都附带 `SHA256SUMS` 校验清单，用于验证下载文件未被篡改或损坏。

**Linux / macOS / WSL / Git Bash：**

```bash
# 1. 下载 SHA256SUMS 和需要的二进制文件（以 v1.2.0 为例）
curl -LO https://github.com/black067/pug-cli/releases/download/v1.2.0/pug-linux-x64
curl -LO https://github.com/black067/pug-cli/releases/download/v1.2.0/SHA256SUMS

# 2. 校验已下载的文件（--ignore-missing 跳过未下载的条目）
sha256sum -c --ignore-missing SHA256SUMS

# 输出 pug-cli/pug-linux-x64: OK 即表示通过
```

**Windows PowerShell：**

```powershell
# 1. 下载文件
Invoke-WebRequest -Uri "https://github.com/black067/pug-cli/releases/download/v1.2.0/pug-win-x64.exe" -OutFile "pug-win-x64.exe"
Invoke-WebRequest -Uri "https://github.com/black067/pug-cli/releases/download/v1.2.0/SHA256SUMS" -OutFile "SHA256SUMS"

# 2. 从清单中提取该文件的预期 SHA256
$expected = (Select-String -Path SHA256SUMS -Pattern "pug-win-x64").Line.Split(" ")[0]

# 3. 计算实际 SHA256 并比较
$actual = (Get-FileHash pug-win-x64.exe -Algorithm SHA256).Hash.ToLower()
if ($actual -eq $expected) { Write-Host "OK" } else { Write-Host "FAIL - 文件可能损坏或已被篡改" }
```

### Build (Optional)

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
      "args": ["<bundledjsPathHere>"]
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
      "command": "<mcpPathHere>",
      "args": []
    }
  }
}
```
