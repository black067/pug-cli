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
npm run build     # 打包 JS + 构建 SEA 可执行文件
npm run bundle    # 仅打包 JS
npm run sea       # 仅构建 SEA 可执行文件
```
