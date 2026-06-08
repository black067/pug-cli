# SVG 输出

通过 `--to-svg`（或 `-S`）参数将 Pug/HTML 渲染为 SVG 矢量图。

## 渲染引擎

底层使用 [Satori](https://github.com/vercel/satori)（v0.26.0）— Vercel 开发的纯 JavaScript 布局引擎：

- **无需浏览器**，纯 JS 运算，适合服务端批量生成
- **跨平台**，在所有 Node.js 环境下工作
- **Flexbox 布局**，支持大部分 CSS 属性

### 约束

- Satori 要求所有 `<div>` 元素只要有 `children` 属性（即使是空数组），就必须显式设置 `display: flex`、`display: contents` 或 `display: none`
- `<style>` 元素会被移除（内联样式不受影响）
- 自闭合标签如 `<hr>` 可用来代替空 `<div>` 避免布局问题

## 字体

### 内置字体

| 字体 | 覆盖范围 |
|------|---------|
| Inter Regular | 拉丁字符（英文、数字、符号） |
| Noto Sans SC Regular | 中日韩（CJK）字符 |

### 加载额外字体

```bash
pug-cli input.pug --to-svg --font /path/to/custom.ttf
```

`--font` 参数可重复使用多次。

**支持的格式**: TTF, OTF, WOFF

**不支持的格式**: TTC（需解包为单个 TTF/OTF）、WOFF2、可变字体（含 `fvar` 表的字体）

### 字体位置解析

默认字体按以下顺序搜索：

1. 相对于脚本目录的 `assets/fonts/`
2. 相对于当前工作目录的 `assets/fonts/`
3. SEA 可执行文件同级目录的 `assets/fonts/`
4. SEA 内嵌资源（构建时注入）

## 画布尺寸

尺寸自动检测优先级：

1. 用户显式 `--width` / `--height`
2. HTML 内联样式中的 `width` / `height`（如 `style="width:800px;height:600px"`）
3. HTML 元素上的 `width` / `height` 属性
4. 默认 800×600

## 颜色 Emoji

默认启用 Twemoji 支持。渲染时自动检测 HTML 中的 Emoji 字符，从 Twemoji CDN 获取 SVG 并嵌入为 base64 data URI。

可通过在调用 `htmlToSvg()` 时设置 `emoji: false` 关闭。

## CLI 选项

```
-S, --to-svg              转换为 SVG（Satori 引擎）
    --width <n>           画布宽度（像素，默认 800）
    --height <n>          画布高度（像素，默认 600）
    --font <path>         加载额外 TTF/OTF/WOFF 字体（可重复）
```

## 编程使用

```js
const { htmlToSvg, jsxToSvg } = require('./src/html2svg');

// HTML → SVG
const svg = await htmlToSvg('<div style="display:flex">Hello</div>', {
  width: 400,
  height: 200,
  extraFonts: ['/path/to/font.ttf'],
});

// JSX 对象 → SVG（跳过 HTML 解析步骤）
const jsx = {
  type: 'div',
  props: {
    style: { display: 'flex', color: 'red' },
    children: 'Hello',
  },
};
const svg2 = await jsxToSvg(jsx, { width: 200, height: 100 });
```
