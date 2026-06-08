## 混合渲染方案：Playwright-Core → Satori 降级

### 架构总览

```
用户输入 .pug / .html
        │
        ▼
   编译为 HTML
        │
        ▼
   ┌─────────────────────────────┐
   │  playwright-core 检测本地    │
   │  Chrome/Edge/Chromium 是否存在 │
   └──────────┬──────────────────┘
              │
       ┌──────┴──────┐
       ▼              ▼
   找到浏览器      没找到浏览器
       │              │
       ▼              ▼
   Playwright      ┌──────────────────────┐
   渲染 HTML → PNG │ 降级到 Satori → SVG   │
   像素级完美      │（已有实现，不动现有逻辑）│
                  └──────────────────────┘
```

---

### 第一步：依赖安装（最小化）

```bash
npm install playwright-core
# 不装浏览器！不跑 npx playwright install
```

对比体积：

| 包 | 安装体积 | 说明 |
|---|---------|------|
| `playwright` | ~200MB+ | 自带 Chromium、Firefox、WebKit |
| `playwright-core` | ~5MB | 仅 API，无浏览器 |
| `puppeteer` | ~300MB | 自带 Chromium |
| `puppeteer-core` | ~5MB | 仅 API，无浏览器 |

---

### 第二步：浏览器检测策略

`playwright-core` 提供了 `install` 方法检测已安装的浏览器，但更稳健的做法是逐级尝试：

| 优先级 | 检测目标 | 适用系统 |
|-------|---------|---------|
| 1️⃣ | 用户通过 `--browser <path>` 指定的路径 | 所有 |
| 2️⃣ | 环境变量 `$CHROME_PATH` / `$BROWSER_PATH` | 所有 |
| 3️⃣ | `playwright-core` 的 `chrome` channel（检测系统 Chrome） | Windows/macOS |
| 4️⃣ | `playwright-core` 的 `msedge` channel（检测系统 Edge） | Windows |
| 5️⃣ | 常见安装路径枚举（`C:\Program Files\Google\Chrome\...` 等） | 所有 |
| 6️⃣ | `playwright` 托管浏览器（如用户主动装过） | 所有 |

核心代码示意：

```js
const { chromium } = require('playwright-core');

async function detectBrowser() {
  // 1. 用户显式指定
  if (userProvidedPath) return userProvidedPath;

  // 2. 环境变量
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  // 3-4. playwright-core 的 channel 检测
  const channels = ['chrome', 'msedge', 'chromium'];
  for (const channel of channels) {
    try {
      const executablePath = chromium.executablePath({ channel });
      if (executablePath) return executablePath;
    } catch { /* 继续下一项 */ }
  }

  // 5. 常见路径枚举 (Windows)
  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS/Linux 路径...
  ];
  for (const p of commonPaths) {
    if (require('fs').existsSync(p)) return p;
  }

  return null; // 未找到 → 降级到 Satori
}
```

---

### 第三步：渲染流程

```js
async function htmlToPng(htmlString, outputPath, opts = {}) {
  const executablePath = detectBrowser();

  if (!executablePath) {
    // 无头浏览器不可用 → 降级到 Satori 输出 SVG
    return fallbackToSatori(htmlString, outputPath, opts);
  }

  // 使用 headless 模式启动已有浏览器
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'], // 避免权限问题
  });

  const context = await browser.newContext({
    viewport: {
      width: opts.width || 800,
      height: opts.height || 600,
    },
    deviceScaleFactor: opts.scale || 2, // Retina 清晰度
  });

  const page = await context.newPage();

  await page.setContent(htmlString, { waitUntil: 'networkidle' });

  // 可选：自动裁剪到内容实际尺寸
  let clip;
  if (opts.autoCrop) {
    const bodyBox = await page.locator('body').boundingBox();
    if (bodyBox) {
      clip = {
        x: bodyBox.x,
        y: bodyBox.y,
        width: Math.ceil(bodyBox.width),
        height: Math.ceil(bodyBox.height),
      };
    }
  }

  await page.screenshot({
    path: outputPath,
    clip,
    type: 'png',
    fullPage: opts.fullPage || false,
  });

  await browser.close();
  return outputPath;
}
```

---

### 第四步：CLI 接口设计

增强 `--to-png` 参数，新增相关选项：

```
  -S, --to-svg              Convert to SVG (via Satori, fallback mode)
  -P, --to-png              Convert to PNG (via Playwright if available)
  -B, --browser <path>      Specify browser executable path (for --to-png)
      --scale <n>           Device scale factor for PNG (default: 2, retina)
      --auto-crop           Auto-crop PNG to content bounding box
      --full-page           Capture full scrollable page as one PNG
```

逻辑判断：

```
if (--to-png) {
  尝试 playwright-core → Chromium 渲染 → 输出 .png
  如果浏览器不可用 → 降级到 Satori → 输出 .svg
  （可加 --force-png 强制要求 PNG，无浏览器时报错）
}

if (--to-svg) {
  现有 Satori 逻辑，不变
}
```

---

### 第五步：用户引导

首次运行 `--to-png` 但检测不到浏览器时，打印友好提示：

```
⚠ 未检测到 Chromium 浏览器。
  --to-png 需要 Chrome/Edge/Chromium 来渲染图片。

  自动降级为 --to-svg（SVG 输出）。

  如需 PNG，请：
  a) 通过 --browser <path> 指定浏览器路径
  b) 设置环境变量 CHROME_PATH
  c) 或安装 Chromium: npx playwright install chromium
```

---

### 降级策略矩阵

| 用户操作 | 系统有 Chromium | 系统无 Chromium |
|---------|---------------|----------------|
| `--to-png` | ✅ 输出 PNG | ⚠ 输出 SVG + 提示 |
| `--to-svg` | ✅ 输出 SVG | ✅ 输出 SVG |
| `--to-png --force-png` | ✅ 输出 PNG | ❌ 报错退出 |

---

### 优缺点总结

**优点：**
- ✅ PNG 和浏览器渲染**像素级一致**
- ✅ 零额外大依赖（复用用户已有 Chrome/Edge）
- ✅ 有稳妥降级路径（Satori SVG）
- ✅ 支持 Retina 缩放（`deviceScaleFactor: 2`）
- ✅ 自动裁剪到内容实际尺寸
- ✅ 支持完整的 CSS（Grid、动画、自定义字体等）

**缺点：**
- ⚠ 启动浏览器有 ~1-3s 延迟（比 Satori 慢）
- ⚠ 无 Chromium 时只能 SVG
- ⚠ 不适合批量大规模生成（每秒几十张的场景）
- ⚠ 资源占用比 Satori 高（浏览器进程内存）

---

### 和 Satori 的选型指南

```
需要批量快速生成（OG Image 等服务端场景）→ Satori
需要所见即所得（UI 截图、报告导出）       → Playwright-core
用户机器有浏览器且可接受几秒等待            → Playwright-core PNG
用户无浏览器 / 需嵌入 SEA 单文件           → Satori SVG
```
