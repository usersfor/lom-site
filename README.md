# 白银城 · 持镜公会 官网

镜中灰雾重燃，持镜重铸。单页响应式官网，原生 HTML/CSS/JS + Three.js，无框架。

## 跑起来

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # 产物在 dist/
npm run preview # 本地预览 dist
```

## 技术栈

- **Vite 8**：开发服务器 + 构建
- **Three.js 0.186**：镜子 3D 模型、镜面 shader（折射 + 径向迷雾 + 破碎颗粒）、贴图序列帧 + mp4 视频在镜内的 object-fit: cover 等比切换
- **GSAP ScrollTrigger + Lenis 平滑滚动**：所有动画由滚动驱动，rAF + IntersectionObserver 懒停省性能
- **原生 HTML + CSS**：零框架，CSS 变量作设计 token，响应式 clamp() 字号 + flex/grid 布局

## 目录结构

```
lom-site/
├── index.html                 # 单页入口,hero + path + cta + footer 四段
├── css/style.css              # 全部样式,--gold/--ink/--bg 等设计 token 在文件顶部
├── js/
│   ├── main.js                # 启动流程、导航、菜单面板、CTA bento 卡片、二维码弹窗、kinetic text
│   └── scene-path01.js        # Three.js 场景:镜子 GLB 加载 + 贴图序列帧 + mp4 + 破碎 shader
├── public/
│   ├── image/                 # 所有静态图片和视频(构建时直接复制到 dist/image)
│   │   ├── qq-qr.png          # QQ 群二维码
│   │   ├── wechat-qr.png      # 微信接待号二维码
│   │   ├── Announce_*.png     # 镜内贴图序列(10 张)
│   │   ├── 占卜服装展示.mp4    # 镜内视频(第二阶段淡入)
│   │   └── *.png              # 5 张立绘(持镜/势力战/秘仪奉献/俱乐部宣战/歌剧魅影)
│   └── moxin/镜子.glb          # 镜子 3D 模型(blender 导出)
├── image/                     # 源素材目录(未打包)
├── mo xin/                    # GLB 源模型目录
└── vite.config.js
```

## 页面四段

| 段 | id | 核心效果 |
|---|---|---|
| **Hero** | — | 大标题 split-title 逐字进场,镜子 Three.js 小尺寸静止态 + 鼠标微幅倾斜 |
| **Path** | `#path` | 镜子随滚动自转 2 圈(720°)+ 从基准 40% 放大到 170%;镜内贴图序列自动切 + mp4 淡入;路径 section 末尾波浪分割触发镜子**破碎**(shader `uSplit` + 向外飞散颗粒) |
| **CTA** | `#download` | 不规则 bento 卡片网格(QQ/微信/B站/抖音/GitHub/邮箱),kinetic text 大标题(鼠标靠近时每个字向外斥力散开),QQ/微信点卡片弹二维码弹窗(QQ 可复制群号) |
| **Footer** | — | 技术栈 marquee + 品牌 meta |

## 镜子动画时间轴(全部滚动驱动,可重复)

```
trans=0 (hero 顶部)  →  trans=1 (path 滚完)
  ├── 自转: sin(π·trans) · ∫ω dt,两端归零,中间最强,有界累加(不随停留膨胀)
  ├── 滚动加转: ease(trans) · 4π  (整圈 720°,两端 mod 2π 同朝向)
  ├── 鼠标影响: trans<0.15 才允许,>0.15 立即让位给滚动
  ├── 缩放: 0.8 + ease(trans)·1.30  (基准 40% → 170%)
  └── 贴图序列: pathProgress 驱动 10 张 Announce PNG + mp4 淡入
      
storyProgress (波浪滚动窗口 ~45vh):
  ├── 0 → 0.35 : 文字环(textRing)向外飞散撤离
  └── 0.15 → 1.0 : 镜面 shader 破碎(uSplit) + 颗粒慢慢飞散(慢动作)
```

## Shader 破碎逻辑(scene-path01.js L756-775)

顶点 shader 里根据 `uSplit`(storyProgress 的归一化值)把每个顶点沿法向量向外推,同时把透明度拉到 0;附加颗粒层用同样的 split 阈值让碎片向外飞散。`uSplit=0` 时镜子完整,`uSplit=1` 时碎片全飞完。

## 资源替换指南

- **QQ 群二维码**:替换 `public/image/qq-qr.png` 即可,弹窗自动识别
- **微信二维码**:替换 `public/image/wechat-qr.png`
- **QQ 群号**:改 `js/main.js` 里 `const QQ_GROUP = '666487283'`(只改这一处,弹窗复制按钮 / fallback / toast 都引用这个常量)
- **B站/抖音/GitHub 链接**:改 `index.html` 里 CTA 卡片对应的 `<a href="...">`
- **邮箱**:改 `index.html` 里 `mailto:join@grey-mist.cn`
- **镜子 GLB 模型**:替换 `public/moxin/镜子.glb`,Three.js 加载时会自动重新计算 bounding box 适配屏幕
- **镜内贴图**:往 `public/image/` 加 PNG/MP4,在 `scene-path01.js` 的 `frameTextures` / `videoTexture` 数组里追加路径
- **立绘**:往 `public/image/` 加 PNG,`index.html` CTA bento 里对应卡片改 `<img>` src

## 设计 token(css/style.css 文件顶部)

```css
--bg:        #f5f2ea     /* 奶油色底 */
--bg-2:      #ebe6da
--bg-3:      #0d0c0a     /* 深色文字环等装饰 */
--ink:       #0d0c0a     /* 正文 */
--ink-dim:   #5a5245     /* 副文案 */
--gold:      #c6a05b     /* 主金色(hover 边/split-title 装饰) */
--gold-dim:  #a08655     /* 淡金 */
--ease:      cubic-bezier(.2,.7,.2,1)
--maxw:      1280px
--font-cn:   "Noto Serif SC", "Source Han Serif", serif
--font-display: "Playfair Display", serif
--font-body:  "Inter", "PingFang SC", sans-serif
```

## 性能注意

- Three.js 渲染层挂在 `.hero__mirror` fixed 画布上,已设 `pointer-events:none` 防止吞掉点击;鼠标跟随改到 window 监听
- rAF 循环里所有与时间相关的量都用 `dt` 累加,不直接用绝对秒数——防止停留久了动画加速
- `IntersectionObserver` 让非可见区的 rAF / ScrollTrigger 自动暂停
- 图片/视频资源走 Vite 的 `public/` 直出,Three.js 用路径字符串直接加载,不 import
