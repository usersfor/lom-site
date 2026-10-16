/* ==========================================================
   HERO — 雾镜（持）Three.js 版
   + 3D 圆柱形文字环（旋转 → 透视广角感）
   ========================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/* ---------- GLSL（大幅简化：只做边缘渐隐）---------- */

const TEXT_VERT = /* glsl */`
  uniform float uSplit;     // 03 阶段撤离:两半向屏幕外侧平移的距离(NDC,0 → ~1.25)
  varying vec2 vUv;
  varying float vNdcX0;     // 位移前的 NDC x(定位中缝)
  varying float vFarSide;   // 是否位于远侧半圈(朝相机的内表面)
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 mvCenter = modelViewMatrix * vec4(vec3(0.0), 1.0);
    vFarSide = (mv.z < mvCenter.z) ? 1.0 : 0.0;

    vec4 clip = projectionMatrix * mv;
    vNdcX0 = clip.x / clip.w;
    // 以屏幕正中为界,左右两半沿屏幕水平方向各向外侧撤走
    clip.x += (vNdcX0 >= 0.0 ? 1.0 : -1.0) * uSplit * clip.w;
    gl_Position = clip;
  }
`;

const TEXT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uTex;
  uniform float uSplit;
  varying vec2 vUv;
  varying float vNdcX0;
  varying float vFarSide;

  // 8×8 Bayer 有序抖动阈值:把覆盖率转成"不透明 / 丢弃"两态,
  // 视觉上仍是平滑边缘,但每个像素都是同一个金色 —— 不与任何背景混合
  float bayer2(vec2 p) {
    vec2 q = mod(floor(p), 2.0);
    return (q.x < 1.0) ? ((q.y < 1.0) ? 0.0 : 3.0)
                       : ((q.y < 1.0) ? 2.0 : 1.0);
  }
  float bayer4(vec2 p) {
    return 4.0 * bayer2(mod(p, 2.0)) + bayer2(floor(p / 2.0));
  }
  float bayer8(vec2 p) {
    return 16.0 * bayer2(mod(p, 2.0)) + bayer4(floor(p / 2.0));
  }
  float bayerThreshold(vec2 sp) {
    return (bayer8(sp) + 1.0) / 64.0;  // 1/64 ~ 1,coverage=0 必被丢弃
  }

  void main() {
    vec2 uv = vec2(1.0 - vUv.x, vUv.y);   // 反转 U → 从内表面看才是正的
    vec4 col = texture2D(uTex, uv);

    // 03 阶段撤离中:位移会翻转部分三角形绕序,显式只保留远侧半圈;
    // 中缝处被拉开的三角形形成拉伸带,按位移前的 NDC x 开缝丢弃
    if (uSplit > 0.001) {
      if (vFarSide < 0.5) discard;
      float seamBand = 0.05 * smoothstep(0.0, 0.05, uSplit);
      if (abs(vNdcX0) < seamBand) discard;
    }

    // 内表面只渲染后半圆
    float edge = abs(uv.x - 0.5) * 2.0;
    float fade = 1.0 - smoothstep(0.78, 0.98, edge);
    float coverage = col.a * fade;

    // 覆盖不足的像素直接丢弃;保留的像素一律不透明金色
    if (coverage < bayerThreshold(gl_FragCoord.xy)) discard;
    gl_FragColor = vec4(col.rgb, 1.0);
  }
`;

/* ---------- 镜子破碎(03 阶段:碎片飞散出视野)---------- */

// 确定性 hash(按碎片编号)
function shRand(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 把几何体拆成"每个三角形一个独立碎片"的非索引几何,并写入逐碎片属性:
// aShCenter(局部重心) / aShDir(飞散方向) / aShAxis(旋转轴) / aShSpeed / aShSpin
// 全部为确定性值,uBreak=0 时碎片严丝合缝拼回原样。
// mesh:用于把世界空间算出的飞散方向逆变换回局部(消化节点旋转/负缩放);
// blockWorld>0 时,同一空间块内的碎片共享随机参数,形成裂片群而非粉尘。
const _wc3 = new THREE.Vector3();
const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
const _wv = new THREE.Vector3();
function shatterifyGeometry(geo, mesh, blockWorld = 0) {
  if (geo.getAttribute('aShDir')) return geo;  // 幂等
  mesh.updateWorldMatrix(true, false);
  const pos = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  const nAttr = geo.attributes.normal;
  const idx = geo.index;
  const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
  // 破碎瞬间模型世界中心(group 已锁定位移 y=-0.6)
  const centerWorld = new THREE.Vector3(0, -0.6, 0);

  const out = new THREE.BufferGeometry();
  const P = new Float32Array(triCount * 9);
  const U = new Float32Array(triCount * 6);
  const N = new Float32Array(triCount * 9);
  const C = new Float32Array(triCount * 9);
  const D = new Float32Array(triCount * 9);
  const AX = new Float32Array(triCount * 9);
  const SP = new Float32Array(triCount * 3);
  const SN = new Float32Array(triCount * 3);

  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      v[k][0] = pos.getX(vi); v[k][1] = pos.getY(vi); v[k][2] = pos.getZ(vi);
    }
    // 局部重心 → 世界重心
    _wc3.set(
      (v[0][0] + v[1][0] + v[2][0]) / 3,
      (v[0][1] + v[1][1] + v[2][1]) / 3,
      (v[0][2] + v[1][2] + v[2][2]) / 3
    );
    mesh.localToWorld(_wc3);
    const cx = _wc3.x, cy = _wc3.y, cz = _wc3.z;

    // 随机种子:粗空间块共享 → 裂片群;否则逐片独立(镜面碎玻璃)
    const seed = blockWorld > 0
      ? Math.floor(cx / blockWorld) * 73856093 + Math.floor(cy / blockWorld) * 19349663 + Math.floor(cz / blockWorld) * 83492791
      : t * 2654435761;
    const r1 = shRand(seed + 1.1), r2 = shRand(seed + 2.2), r3 = shRand(seed + 3.3);
    const r4 = shRand(seed + 4.4), r5 = shRand(seed + 5.5), r6 = shRand(seed + 6.6);

    // 世界空间飞散方向:先确定屏幕平面方向(径向 + 扰动 + 下坠),
    // 保证平面分量足够(不能只沿 z 轴飘,否则满程后仍残留在视野中部)
    let wx = (cx - centerWorld.x) * 1.3 + (r1 - 0.5) * 0.7;
    let wy = (cy - centerWorld.y) * 1.3 + (r2 - 0.5) * 0.7 - 0.3;
    if (Math.abs(wx) + Math.abs(wy) < 0.45) {
      wx += (cx >= centerWorld.x ? 1 : -1) * 0.5;
      wy += (cy >= centerWorld.y ? 1 : -1) * 0.5;
    }
    const pl = Math.hypot(wx, wy) || 1;
    wx /= pl; wy /= pl;
    // 再叠加前后错层(占比受控,平面方向仍是主导)
    let wz = (cz - centerWorld.z) * 0.8 + (r3 - 0.5) * 0.7;
    const wl = Math.hypot(wx * 0.9, wy * 0.9, wz) || 1;
    wx = wx * 0.9 / wl; wy = wy * 0.9 / wl; wz /= wl;
    // 世界方向逆变换回局部(只取方向:把原点和单位点分别逆变换)
    _wa.copy(_wc3);
    _wv.set(wx, wy, wz);
    _wb.copy(_wc3).add(_wv);
    mesh.worldToLocal(_wa); mesh.worldToLocal(_wb);
    _wb.sub(_wa);
    let dx = _wb.x, dy = _wb.y, dz = _wb.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    // 局部重心(碎片绕自身重心旋转)
    const lcx = (v[0][0] + v[1][0] + v[2][0]) / 3;
    const lcy = (v[0][1] + v[1][1] + v[2][1]) / 3;
    const lcz = (v[0][2] + v[1][2] + v[2][2]) / 3;

    // 随机旋转轴(避免零向量)
    let ax = r4 - 0.5, ay = r5 - 0.5, az = r6 - 0.5;
    const al = Math.hypot(ax, ay, az);
    if (al < 0.05) { ax = 1; ay = 0; az = 0; } else { ax /= al; ay /= al; az /= al; }

    const speed = 3.4 + shRand(seed + 7.7) * 0.8;   // 局部单位,世界 ×2.55,满程必出视锥
    const spin = (shRand(seed + 8.8) - 0.5) * 6.0;   // 弧度

    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      P[o] = v[k][0]; P[o + 1] = v[k][1]; P[o + 2] = v[k][2];
      if (uvAttr) {
        const ui = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        U[t * 6 + k * 2] = uvAttr.getX(ui);
        U[t * 6 + k * 2 + 1] = uvAttr.getY(ui);
      }
      if (nAttr) {
        const ni = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        N[o] = nAttr.getX(ni); N[o + 1] = nAttr.getY(ni); N[o + 2] = nAttr.getZ(ni);
      }
      C[o] = lcx; C[o + 1] = lcy; C[o + 2] = lcz;
      D[o] = dx; D[o + 1] = dy; D[o + 2] = dz;
      AX[o] = ax; AX[o + 1] = ay; AX[o + 2] = az;
      SP[t * 3 + k] = speed;
      SN[t * 3 + k] = spin;
    }
  }

  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (uvAttr) out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('normal', nAttr ? new THREE.BufferAttribute(N, 3) : new THREE.BufferAttribute(N, 3));
  out.setAttribute('aShCenter', new THREE.BufferAttribute(C, 3));
  out.setAttribute('aShDir', new THREE.BufferAttribute(D, 3));
  out.setAttribute('aShAxis', new THREE.BufferAttribute(AX, 3));
  out.setAttribute('aShSpeed', new THREE.BufferAttribute(SP, 1));
  out.setAttribute('aShSpin', new THREE.BufferAttribute(SN, 1));
  out.computeBoundingSphere();
  return out;
}

// 给现有材质(标准/基础通用)注入碎片顶点动画,保留原有光照与贴图
const SHATTER_GLSL = /* glsl */`
  uniform float uBreak;
  attribute vec3 aShCenter;
  attribute vec3 aShDir;
  attribute vec3 aShAxis;
  attribute float aShSpeed;
  attribute float aShSpin;
  vec3 shatterRotate(vec3 p, vec3 ax, float c, float s) {
    return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c);
  }
`;

const _shatterInjected = new WeakSet();
function injectShatter(mat, uniformRef) {
  const list = Array.isArray(mat) ? mat : [mat];
  list.forEach((m) => {
    if (!m || _shatterInjected.has(m)) return;
    _shatterInjected.add(m);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBreak = uniformRef;
      shader.vertexShader = SHATTER_GLSL + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 sRel = transformed - aShCenter;
          float sAng = uBreak * aShSpin;
          float sC = cos(sAng), sS = sin(sAng);
          sRel = shatterRotate(sRel, aShAxis, sC, sS);
          transformed = aShCenter + sRel + aShDir * (uBreak * aShSpeed);
        }`
      );
    };
  });
}

/* ---------- Canvas 文字贴图 ---------- */

function createTextTexture() {
  const canvas = document.createElement('canvas');
  const H = 512;
  const W = H * 8;   // 8:1，足够大
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const phrase = '白银城 · 持镜   ·   BAIYINCHENG · MIRRORKEEPER   ·   二十二条途径   ·   TWENTY-TWO PATHS   ·   灰雾之上   ·   ABOVE THE GREY MIST   ·   占卜家途径   ·   DIVINER PATH   ';
  const fontSize = H * 0.42;
  ctx.font = `700 ${fontSize}px "Noto Serif SC", "Playfair Display", "Times New Roman", serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d4af5b';

  const segmentW = ctx.measureText(phrase).width;
  const copies = Math.ceil(W / segmentW) + 1;

  // 不加 shadowBlur 辉光:半透明光晕会与不同背景混合,叠到深色内容上变成白边
  for (let i = 0; i < copies; i++) {
    ctx.fillText(phrase, i * segmentW, H / 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/* ---------- 程序化环境贴图 → PMREM ---------- */

function createProceduralEnv(renderer) {
  // 等距柱状全景(equirectangular):2:1,宽 2048 高 1024 足够清晰
  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // 底部奶油黄暖 → 顶部冷灰蓝(网页主色调),模拟室内柔光
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,    '#e8e2d4');  // 顶:奶油灰
  bg.addColorStop(0.5,  '#d4ccb8');  // 赤道
  bg.addColorStop(1,    '#c6bfa8');  // 底
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // 几团明亮光斑(模拟灯/窗)——在反射里会形成锐利高光条
  const blobs = [
    { cx: 0.20, cy: 0.30, r: 0.18, col: 'rgba(255,240,210,0.55)' },  // 左上暖光
    { cx: 0.78, cy: 0.28, r: 0.15, col: 'rgba(255,235,195,0.45)' },  // 右上
    { cx: 0.50, cy: 0.55, r: 0.22, col: 'rgba(255,248,230,0.30)' },  // 中心大柔光
    { cx: 0.10, cy: 0.75, r: 0.14, col: 'rgba(210,220,230,0.40)' },  // 左下冷灰
    { cx: 0.88, cy: 0.78, r: 0.16, col: 'rgba(200,215,235,0.35)' },  // 右下冷灰
  ];
  for (const b of blobs) {
    const x = b.cx * W, y = b.cy * H, r = b.r * Math.max(W, H);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    const halfAlpha = b.col.replace(/([\d.]+)\)$/, (_, a) => (parseFloat(a) * 0.4).toFixed(2) + ')');
    rg.addColorStop(0, b.col);
    rg.addColorStop(0.5, halfAlpha);
    rg.addColorStop(1, 'rgba(200,200,200,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }

  // 水平方向的暗角条(模拟地面/墙面分界线),让反射有层次
  g.fillStyle = 'rgba(120,100,70,0.12)';
  g.fillRect(0, H * 0.72, W, H * 0.28);

  // Canvas → THREE.Texture → PMREM
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return envTex;
}

/* ---------- 主 ---------- */

export function initPath01Scene() {
  const container = document.getElementById('heroMirror');
  if (!container) return { dispose() {}, update() {} };

  const state = {
    renderer: null,
    scene: null,
    camera: null,
    model: null,
    modelBaseScale: 1,  // 模型初始缩放(加载后记录)
    mirrorPlane: null,  // 镜子.glb 里贴图片序列的 mesh(上层)
    videoPlane: null,   // 复制出来的 mesh(贴视频,下层,做淡入)
    mirrorTex: null,    // 当前贴在平面上的 Texture(图片序列帧 / 视频)
    videoEl: null,      // 视频 DOM 元素
    textRing: null,
    ringRadius: 4,      // 小半径 → 圆周长 ≈ 25,匹配 canvas 8:1
    ringHeight: 3.2,
    textMat: null,
    scrollProgress: 0,
    pathProgress: 0,    // path section 专属滚动进度,驱动平面图片/视频切换
    storyProgress: 0,   // 03 战绩 section 进度,驱动文字环向两侧撤离
    shatterUniforms: null,  // 镜子碎片材质共享的 { value: 0→1 }
    mouseX: 0.5,
    targetRotY: 0,
    ringRotY: 0,
    planeAspect: 1,          // 镜面椭圆的几何宽高比 rx/ry —— 用于贴图 cover 计算
    timer: new THREE.Timer(),
    rafId: null,
    disposed: false,
  };

  function setup() {
    const w = container.clientWidth;
    const h = container.clientHeight;

    state.scene = new THREE.Scene();
    state.scene.background = null;

    state.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    state.camera.position.set(0, 0.2, 5);
    state.camera.lookAt(0, 0, 0);

    state.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.setSize(w, h);
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.2;
    container.appendChild(state.renderer.domElement);

    // ★ 环境贴图:程序化 Canvas(奶油底金斑) → PMREM → scene.environment
    // 所有 MeshPhysicalMaterial 会自动用这个做反射 / 折射,呈现玻璃质感
    state.scene.environment = createProceduralEnv(state.renderer);
    state.scene.background = null;  // 透明 canvas,让网站背景透过来(镜子反射更像"周围环境")

    // 灯光
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 4, 5);
    state.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc6a05b, 0.6);
    fill.position.set(-3, 2, -3);
    state.scene.add(fill);

    // === 3D 圆柱形文字环 ===
    // 用 CylinderGeometry，大半径 → 侧面弧形透视产生自然的广角感
    // 旋转圆柱 → 文字滚过视野（真实 3D 运动，不是 shader 假装）
    const textTex = createTextTexture();
    state.textMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: textTex },
        uSplit: { value: 0 },    // 03 阶段文字从中缝向两侧撤离的距离(NDC)
      },
      vertexShader: TEXT_VERT,
      fragmentShader: TEXT_FRAG,
      transparent: false,         // 颜色恒定:二态遮罩在 shader 内用 discard 完成
      depthWrite: true,
      side: THREE.BackSide,       // 只渲染内表面 → 凹陷感
    });

    const segRadial = 128;
    const segHeight = 1;
    const geo = new THREE.CylinderGeometry(
      state.ringRadius,
      state.ringRadius,
      state.ringHeight,
      segRadial,
      segHeight,
      true
    );

    state.textRing = new THREE.Mesh(geo, state.textMat);
    state.textRing.rotation.y = Math.PI;   // 翻转 → 内表面朝相机
    state.textRing.position.set(0, 0, -2);
    state.textRing.renderOrder = 0;
    state.scene.add(state.textRing);

    // 镜子 GLB:public/ 目录资源,直接用相对路径
    const url = './moxin/mirror.glb';
    console.log('[Scene] GLB 请求 URL:', url);
    console.time('[Scene] GLB total');
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        try {
          console.timeEnd('[Scene] GLB total');
          console.log('[Scene] GLB 加载成功,开始处理...');
          console.time('[Scene] GLB 处理');
          state.model = gltf.scene;
        const box = new THREE.Box3().setFromObject(state.model);
        const size = box.getSize(new THREE.Vector3());
        const targetSize = 1.8;
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = targetSize / maxDim;
        state.model.scale.setScalar(scale);
        state.model.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(state.model);
        state.model.position.sub(box2.getCenter(new THREE.Vector3()));
        state.modelBaseScale = scale;  // 记录初始基准缩放

        // ★ 把 GLB 里所有 mesh 名字打印出来,方便调试(生产前可删)
        state.model.traverse((o) => {
          if (o.isMesh) console.log('[Scene] mesh:', JSON.stringify({
            name: o.name,
            verts: o.geometry.attributes.position?.count,
            bbox: (() => {
              o.geometry.computeBoundingBox();
              const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
              return { x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3) };
            })(),
            origMat: o.material?.type,
          }));
        });

        // ★ 绑定 mirrorPlane:不再硬编码依赖"平面"名字
        // 优先匹配名字(含"平面"/"镜"/Mirror/Plane),否则 fallback 到 box.z 最小的 mesh
        // (贴图片的平面 mesh 通常厚度或 z 维度最薄,镜框/装饰都是 3D 有厚度)
        const meshes = [];
        state.model.traverse((o) => {
          if (o.isMesh) meshes.push(o);
        });
        let mirrorPlane = null;
        const nameHit = meshes.find(m =>
          /平面|镜|mirror|plane/i.test(m.name.trim())
        );
        if (nameHit) {
          mirrorPlane = nameHit;
          console.log('[Scene] mirrorPlane 通过名字匹配:', nameHit.name);
        } else {
          // fallback:box 某个维度特别小(≤ 另外两个维度最大值的 25%)
          let best = null, bestFlatness = Infinity;
          for (const m of meshes) {
            m.geometry.computeBoundingBox();
            const s = m.geometry.boundingBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(s.x, s.y, s.z);
            const minDim = Math.min(s.x, s.y, s.z);
            const flatness = minDim / maxDim;  // 越小越扁平,越像贴图片的面
            if (flatness < bestFlatness) {
              bestFlatness = flatness;
              best = m;
            }
          }
          mirrorPlane = best;
          console.log('[Scene] mirrorPlane 通过扁平度 fallback:', mirrorPlane?.name, 'flatness=', bestFlatness.toFixed(3));
        }

        if (!mirrorPlane) {
          console.error('[Scene] GLB 里没找到任何 mesh!');
          state.scene.add(state.model);
          animate();
          return;
        }
        state.mirrorPlane = mirrorPlane;

        // ★ 给非 mirrorPlane 的 mesh 换 MeshPhysicalMaterial → 玻璃/金属反射质感
        // 保留原 color/map(如果 GLB 里有贴图),加 envMap 自动接 scene.environment
        for (const m of meshes) {
          if (m === mirrorPlane) continue;  // mirrorPlane 后面单独换 MeshBasicMaterial
          // 保留原始 color 和 map
          const origMat = m.material;
          // 水晶玻璃质感:薄环管用纯 opacity 透明 + clearcoat 高光 + envMap 反射
          // (transmission 只对实心闭合几何如玻璃球有效,薄环管没有"厚度"让光折射)
          const pbr = new THREE.MeshPhysicalMaterial({
            color: origMat?.color ? origMat.color.clone() : new THREE.Color(0xf5efe0),
            map: origMat?.map || null,
            metalness: 0.35,             // 半金属——水晶里有一点金属反射
            roughness: 0.02,             // 极光滑 → 锐利高光 + 清晰 envMap 反射
            clearcoat: 1.0,              // 表面一层亮水晶高光
            clearcoatRoughness: 0.01,
            opacity: 0.12,               // ★ 更薄的水晶壳(几乎全透,只留反射高光)
            transparent: true,
            side: THREE.DoubleSide,      // 环管 + 碎片多角度 → 两面都渲染
            depthWrite: false,
            depthTest: true,
            envMapIntensity: 2.0,        // 反射更亮补透明度的"消失感"
          });
          // dispose 旧材质
          if (Array.isArray(origMat)) origMat.forEach(om => om.dispose());
          else if (origMat) origMat.dispose();
          m.material = pbr;
        }

        // ★ mirrorPlane 后续处理:椭圆检测 → 替换 geometry → MeshBasicMaterial → videoPlane
        // 以下都是直接对 mirrorPlane 操作,不再 traverse 循环

            // ============================================================
            // ★ 镜面开口 = 椭圆环内缘(王冠、吊坠只是装饰,不算边框)
            // ------------------------------------------------------------
            // 直接遍历镜框顶点,按高度统计每一列离镜面中线最近的顶点(环管内
            // 边缘),由此实测出内缘椭圆的中心与半径 —— 上下严格关于椭圆环自身
            // 对称,顶部绝不伸入王冠。再在世界空间生成椭圆(UV 随世界朝上,
            // 保证图片/视频正立),整体逆变换到「平面」局部,消化节点负缩放。
            // ============================================================
            const o = mirrorPlane;
            state.model.updateMatrixWorld(true);

            // 找镜框:除 mirrorPlane 外面积最大的 mesh
            let frameMesh = null, frameArea = -1;
            for (const m of meshes) {
              if (m === o) continue;
              m.geometry.computeBoundingBox();
              const fs = m.geometry.boundingBox.getSize(new THREE.Vector3());
              const a = fs.x * fs.z + fs.x * fs.y + fs.y * fs.z;
              if (a > frameArea) { frameArea = a; frameMesh = m; }
            }

            if (frameMesh) {
              // 世界空间按 y 分桶(0.01),记录每桶顶点的最小 |x| = 环管内缘半宽
              const BIN = 0.01;
              const bins = new Map();
              const wv = new THREE.Vector3();
              const fPos = frameMesh.geometry.attributes.position;
              for (let i = 0; i < fPos.count; i++) {
                wv.fromBufferAttribute(fPos, i).applyMatrix4(frameMesh.matrixWorld);
                if (Math.abs(wv.z) > 0.05) continue; // 只取环面附近
                const key = Math.round(wv.y / BIN);
                let b = bins.get(key);
                if (!b) { b = { y: key * BIN, minAbsX: Infinity }; bins.set(key, b); }
                const ax = Math.abs(wv.x);
                if (ax < b.minAbsX) b.minAbsX = ax;
              }
              const rows = [...bins.values()].sort((p, q) => p.y - q.y);

              // 赤道桶=内缘最宽处;取其上下各 3 桶平均,得到内缘赤道半宽
              let ie = 0;
              for (let i = 1; i < rows.length; i++)
                if (rows[i].minAbsX > rows[ie].minAbsX) ie = i;
              let sum = 0, cnt = 0;
              for (let k = Math.max(0, ie - 3); k <= Math.min(rows.length - 1, ie + 3); k++)
                { sum += rows[k].minAbsX; cnt++; }
              const rxIn = sum / cnt;

              // 由赤道向上下扫描:内缘宽度跌破阈值即到椭圆极点(再往外就是王冠/吊坠)
              const CUT = Math.max(0.01, 0.05 * rxIn);
              let it = ie;
              while (it + 1 < rows.length && rows[it + 1].minAbsX >= CUT) it++;
              let ib = ie;
              while (ib - 1 >= 0 && rows[ib - 1].minAbsX >= CUT) ib--;
              const yLo = rows[ib].y, yHi = rows[it].y;
              const cyWorld = (yLo + yHi) / 2;
              const ryIn = (yHi - yLo) / 2;

              // 水平中心:镜框左右对称,取世界 AABB 的 x 中心
              const fBox = new THREE.Box3().setFromObject(frameMesh);
              const cxWorld = (fBox.min.x + fBox.max.x) / 2;

              // 实测可见洞口(环管靠前唇边)比内缘顶点包络大约 8%,外扩后贴合;
              // 上缘仍远在王冠起点之下,左右压入实心环带,不会从镂空漏出
              const FIT = 1.08;
              const rx = rxIn * FIT, ry = ryIn * FIT;
              state.planeAspect = rx / ry;  // 椭圆真实几何宽高比

              // 世界空间生成正立椭圆,再逆变换到「平面」局部空间
              // 多层径向细分网格(RINGS 层):03 破碎时每小片都是小三角玻璃,
              // 而不是 96 块从中心拉到边缘的大扇形
              const inv = o.matrixWorld.clone().invert();
              const SEG = 96;
              const RINGS = 12;
              const positions = [];
              const uvs = [0.5, 0.5];
              const indices = [];
              const wc = new THREE.Vector3(cxWorld, cyWorld, 0).applyMatrix4(inv);
              positions.push(wc.x, wc.y, wc.z);
              const wp = new THREE.Vector3();
              for (let j = 1; j <= RINGS; j++) {
                const rr = j / RINGS;
                for (let i = 0; i <= SEG; i++) {
                  const ang = (i / SEG) * Math.PI * 2;
                  const cosA = Math.cos(ang), sinA = Math.sin(ang);
                  wp.set(cxWorld + rx * rr * cosA, cyWorld + ry * rr * sinA, 0).applyMatrix4(inv);
                  positions.push(wp.x, wp.y, wp.z);
                  // v 随世界 y 增大;图片/视频纹理 flipY 默认 true,v=1 即画面顶部 → 正立
                  uvs.push(0.5 + 0.5 * rr * cosA, 0.5 + 0.5 * rr * sinA);
                }
              }
              // 中心 → 第一层的扇形
              for (let i = 0; i < SEG; i++) indices.push(0, 1 + i, 1 + i + 1);
              // 其余各层之间的四边形(两个三角)
              for (let j = 2; j <= RINGS; j++) {
                const a0 = 1 + (j - 2) * (SEG + 1);
                const b0 = 1 + (j - 1) * (SEG + 1);
                for (let i = 0; i < SEG; i++) {
                  indices.push(a0 + i, b0 + i, a0 + i + 1);
                  indices.push(b0 + i, b0 + i + 1, a0 + i + 1);
                }
              }

              const ovalGeo = new THREE.BufferGeometry();
              ovalGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
              ovalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
              ovalGeo.setIndex(indices);
              ovalGeo.computeVertexNormals();
              ovalGeo.computeBoundingSphere();
              o.geometry = ovalGeo;
            }

            // 镜面平面:public/ 目录资源
            const mirrorTexUrl = './image/jingmian.png';
            console.log('[Scene] 镜面 PNG 请求 URL:', mirrorTexUrl);
            const mirrorTex = new THREE.TextureLoader().load(mirrorTexUrl, (tex) => {
              // onLoad:贴图就位后按椭圆真实 aspect 做 object-fit cover 居中裁剪
              const natA = tex.image.width / tex.image.height;
              const ellA = state.planeAspect || 1;
              if (natA > ellA) {
                tex.repeat.set(1, ellA / natA);
                tex.offset.set(0, (1 - ellA / natA) / 2);
              } else {
                tex.repeat.set(natA / ellA, 1);
                tex.offset.set((1 - natA / ellA) / 2, 0);
              }
            }, undefined, (err) => {
              console.error('[Scene] 镜面 PNG 加载失败:', err);
            });
            mirrorTex.colorSpace = THREE.SRGBColorSpace;
            mirrorTex.anisotropy = 4;

            o.material = new THREE.MeshBasicMaterial({
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 1,
              depthWrite: false,
              map: mirrorTex,
              color: new THREE.Color(0xffffff),
            });
            state.mirrorTex = mirrorTex;

        // 镜子整体破碎用的共享 uniform(0=完整,1=完全飞散)
        state.shatterUniforms = { value: 0 };
        state.model.traverse((o) => {
          if (o.isMesh) {
            o.renderOrder = 1;
            // 几何拆成独立碎片 + 材质注入飞散动画(镜框、图片面、视频面统一处理)
            const isPlaneMesh = o === state.mirrorPlane || o === state.videoPlane;
            o.geometry = shatterifyGeometry(o.geometry, o, isPlaneMesh ? 0 : 0.3);
            injectShatter(o.material, state.shatterUniforms);
            // 全部 mesh 统一 depthWrite:false(镜框玻璃透明 + 图片/视频面透明)
            if (o.material) o.material.depthWrite = false;
          }
        });

        state.scene.add(state.model);
        animate();
        console.timeEnd('[Scene] GLB 处理');
        console.log('[Scene] animate() 已启动 ✓');
        } catch (e) {
          console.error('[Scene] GLB 处理异常:', e);
          console.trace(e);
        }
      },
      undefined,
      (err) => {
        console.error('[Scene] GLB 加载失败:', err);
        console.warn('[Scene] 尝试不带 meshopt decoder 解析...');
        // fallback: 即使 GLB 加载失败也启动空场景,至少 canvas 不透明
        console.warn('[Scene] GLB 无法加载,镜子模型不会显示');
      }
    );

    // 鼠标:在 window 上监听 —— .hero__mirror 是 pointer-events:none 的全屏层,
    // 自身收不到事件,但跟随只需要全局鼠标坐标
    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      state.mouseX = Math.max(0, Math.min(1, x));
    };
    window.addEventListener('mousemove', onMove);
    state._onMove = onMove;

    const ro = new ResizeObserver(() => {
      if (!state.renderer || state.disposed) return;
      const w2 = container.clientWidth, h2 = container.clientHeight;
      state.camera.aspect = w2 / h2;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(w2, h2);
    });
    ro.observe(container);
    state._ro = ro;
  }

  function animate() {
    if (state.disposed) return;
    state.rafId = requestAnimationFrame(animate);
    state.timer.update();

    const t = state.timer.getElapsed();
    // 总进度:0(hero 顶部进视口)→ 1(path section 完全滚完)
    const trans = Math.max(0, Math.min(1, state.scrollProgress));

    // 旋转 + 放大:实时 trans 驱动,前快后慢,往回滚时自然反向动画(可重复)
    const e = trans < 0.5
      ? 4 * trans * trans * trans
      : 1 - Math.pow(-2 * trans + 2, 3) / 2;

    // 鼠标 → 镜子微幅倾斜:仅在初始静止态(trans<0.15)允许,
    // 一旦镜子开始被滚动驱动自转转场,立即让位给滚动
    const mouseInfluence = trans < 0.15 ? 1 : 0;
    const target = Math.max(-0.12, Math.min(0.12, (state.mouseX - 0.5) * 0.35 * mouseInfluence));
    state.targetRotY += (target - state.targetRotY) * 0.08;

    if (state.model) {
      // 旋转:有界累加自转 + 整圈滚动驱动——
      // 滚动项 e*4π = 720°,起点终点 mod 2π 同朝向(正对);
      // 自转 spinAcc 由瞬时角速度累加:omega = sin(π*trans)*0.12(两端归零,中间最大),
      // 每帧加 omega*dt,且 trans<0.01 时强制清零(滚回顶部不残留),
      // 整个 spinAcc 有界 ∫₀¹ 0.12·sin(πx)dx ≈ 0.077 rad,绝不无限增长
      const dt = Math.min(0.1, state.timer.getDelta());  // clamp 防爆跳帧
      const omega = Math.sin(Math.PI * trans) * 0.12;
      state.spinAcc = (state.spinAcc || 0) + omega * dt;
      if (trans < 0.01) state.spinAcc = 0;
      state.model.rotation.y =
        state.spinAcc +
        e * Math.PI * 4 +
        state.targetRotY;

      // 放大:初始静止态 40% 基准 → 结尾 100%,从小镜子滚到大镜子
      const scaleFactor = 0.8 + e * 1.00;
      state.model.scale.setScalar(state.modelBaseScale * scaleFactor);

      // 位置:保持初始悬浮,只在自转停止后浮动也停
      const floatY = Math.sin(t * 1.2) * 0.2 * (1 - trans);
      state.model.position.y = floatY - 0.6;
      state.model.position.z = 0;
    }

    // 文字圆柱:跟镜子同步,结尾也完全锁定
    state.textRing.rotation.y = Math.PI - t * 0.15 * (1 - trans) - e * Math.PI * 1.2;
    state.textRing.scale.setScalar(1 + e * 0.3);

    // 03 阶段:破碎提前 + 慢动作
    // 滚动窗口已在 boot 里拉到 ~45vh(path 65% → 波浪滚出),
    // shader 窗口:textRing 0→0.20 提前撤完,shatter 0.15→1.0 占 85% 窗口慢动作飞散
    const sp = Math.max(0, Math.min(1, state.storyProgress));
    const textRaw = Math.min(1, sp / 0.20);
    const textEase = textRaw * textRaw * (3 - 2 * textRaw);
    state.textMat.uniforms.uSplit.value = textEase * 1.25;
    if (state.shatterUniforms) {
      const shatterRaw = Math.max(0, Math.min(1, (sp - 0.15) / 0.85));
      state.shatterUniforms.value = shatterRaw * shatterRaw * (3 - 2 * shatterRaw);
    }

    state.renderer.render(state.scene, state.camera);
  }

  setup();

  return {
    update(p) { state.scrollProgress = Math.max(0, Math.min(1, p)); },
    updatePathProgress(p) { state.pathProgress = Math.max(0, Math.min(1, p)); },
    updateStoryProgress(p) { state.storyProgress = Math.max(0, Math.min(1, p)); },
    dispose() {
      state.disposed = true;
      cancelAnimationFrame(state.rafId);
      state._ro?.disconnect();
      if (state._onMove) window.removeEventListener('mousemove', state._onMove);
      state.scene?.traverse((o) => {
        if (o.isMesh) { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material?.dispose(); }
      });
      state.textMat?.uniforms.uTex.value?.dispose?.();
      state.mirrorTex?.dispose?.();
      state.renderer?.dispose();
      state.renderer?.domElement?.remove();
    },
  };
}
