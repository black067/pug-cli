# PNG 输出

通过 `--to-png`（或 `-P`）参数将 Pug/HTML 渲染为 PNG 图片。

## 渲染引擎

底层使用 [Playwright](https://playwright.dev/)（headless Chromium 模式）：

- **像素级完美**: 调用系统已安装的 Chrome/Edge/Chromium 渲染，与浏览器实际显示一致
- **完整 CSS 支持**: Grid、Flexbox、动画、自定义字体、渐变等
- **自动降级**: 未检测到浏览器时自动降级为 SVG 输出（Satori 引擎）

## 系统要求

- **操作系统**: Windows / macOS / Linux
- **浏览器**: 系统中已安装 **Chrome、Edge 或 Chromium**（任一即可）
- **无需额外下载**，`playwright-core` 仅提供 API 接口（~5MB）

> SEA 单文件不包含浏览器引擎。需通过 `node src/cli.js` 运行才能使用 `--to-png`。

## 浏览器检测优先级

`pug-cli` 按以下顺序检测系统浏览器：

| 优先级 | 检测方式 |
|--------|---------|
| 1 | `--browser <path>` 显式指定路径 |
| 2 | 环境变量 `CHROME_PATH` 或 `BROWSER_PATH` |
| 3 | Playwright 系统 Chrome channel 检测 |
| 4 | Playwright 系统 Edge channel 检测（Windows） |
| 5 | 常见安装路径枚举（`C:\Program Files\Google\Chrome\...` 等） |
| 6 | Playwright 托管浏览器（`npx playwright install chromium`） |

## CLI 选项

| 参数 | 简写 | 说明 | 默认 |
|------|------|------|------|
| `--to-png` | `-P` | 转换为 PNG | false |
| `--browser <path>` | `-B` | 指定浏览器可执行路径 | 自动检测 |
| `--width <n>` | | 视口宽度（像素，自动从内容检测） | 自动 |
| `--height <n>` | | 视口高度（像素，自动从内容检测） | 自动 |
| `--scale <n>` | | 设备缩放因子（Retina） | 2 |
| `--auto-crop` | | 自动裁剪到内容实际尺寸 | false |
| `--full-page` | | 捕获完整滚动页面 | false |
| `--force-png` | | 强制 PNG，无浏览器时报错退出 | false |

### 选项说明

- **`--width` / `--height`**: 默认自动从内容中检测尺寸。检测顺序：
  1. HTML 内联样式 `style="width:800px;height:600px"`
  2. 元素上的 `width="400" height="800"` 属性（支持 `<svg>`、`<img>` 等）
  3. 回退默认 800×600
- **`--scale`**: 设置 `deviceScaleFactor`，值越大 PNG 越清晰。2 对应 Retina 2x 清晰度。
- **`--auto-crop`**: 渲染后自动检测 `<body>` 的边界框，将 PNG 裁剪到内容实际尺寸，去除空白边距。
- **`--full-page`**: 捕获整个滚动页面内容，而不是仅视口区域。
- **`--force-png`**: 当系统没有 Chromium 浏览器时不降级为 SVG，直接报错退出。

## 降级策略

| 用户操作 | 有 Chromium | 无 Chromium |
|---------|------------|------------|
| `--to-png` | ✅ 输出 PNG | ⚠ 输出 SVG + 提示 |
| `--to-png --force-png` | ✅ 输出 PNG | ❌ 报错退出 |
| `--to-svg` | ✅ 输出 SVG | ✅ 输出 SVG |

## 编程使用

```js
const { htmlToPng, checkBrowserAvailable } = require('./src/html2png');

// 检查浏览器是否可用
const info = checkBrowserAvailable();
console.log(info.available);   // true / false
console.log(info.executablePath); // 浏览器路径或 null

// HTML → PNG
const outputPath = await htmlToPng(
  '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:white;font-size:24px;font-family:sans-serif">Hello PNG</div>',
  './output.png',
  {
    width: 800,
    height: 600,
    scale: 2,       // Retina 清晰度
    autoCrop: true, // 自动裁剪
  }
);
```

## 与 SVG 的选型指南

| 场景 | 推荐 |
|------|------|
| 批量快速生成（OG Image 等服务端） | Satori → SVG |
| 所见即所得（UI 截图、报告导出） | Playwright → PNG |
| 用户机器有浏览器且可接受几秒等待 | Playwright → PNG |
| 无浏览器 / 需嵌入 SEA 单文件 | Satori → SVG |
