// --- Game Configuration & States ---
const state = {
  gameState: 'lobby', // 'lobby', 'playing', 'gameover'
  time: 0,
  speed: 0,
  coins: 0,
  lap: 1,
  maxLaps: 1, // プロトタイプは1周でゴール
  startTime: 0,
  bestTimes: { course1: null, course2: null },
  muted: false,
  
  // Controls
  keys: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    drift: false
  },
  
  // 3D Scene Entities
  scene: null,
  camera: null,
  renderer: null,
  kart: null, // THREE.Group
  wheels: [], // タイヤのメッシュを格納（回転アニメーション用）
  coinsList: [], // コインの3Dオブジェクト
  dashPads: [], // ダッシュ床の3Dオブジェクト
  particles: [], // 煙パーティクル
  rivals: [], // ライバルカートの配列 (AI)
  playerT: 0, // プレイヤーの現在のコース位置(0.0〜1.0)
  
  // Kart Physics
  physics: {
    x: 0,
    y: 12.4,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    angle: 0,
    speed: 0,
    maxSpeed: 0.8,
    accel: 0.015,
    decel: 0.96, // 摩擦
    turnSpeed: 0.04,
    gravity: -0.015,
    isFalling: false
  },
  
  // Audio Context
  audioCtx: null
};

// --- Web Audio Synthesizer ---
function initAudio() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type, param = 1) {
  if (state.muted || !state.audioCtx) return;
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
  
  const ctx = state.audioCtx;
  const now = ctx.currentTime;
  
  switch(type) {
    case 'coin': { // コイン獲得 (ピコーン！高いアルペジオ)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc1.type = 'sine';
      osc2.type = 'sine';
      
      osc1.frequency.setValueAtTime(987.77, now); // B5
      osc1.frequency.setValueAtTime(1318.51, now + 0.08); // E6
      osc2.frequency.setValueAtTime(1318.51, now);
      osc2.frequency.setValueAtTime(1975.53, now + 0.08); // B6
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.3);
      osc2.stop(now + 0.3);
      break;
    }
    case 'dash': { // ダッシュ床 (シュウィーーーン！)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.4);
      
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      
      // ローパスフィルターで少し丸みを持たせる
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.4);
      break;
    }
    case 'drift': { // タイヤ摩擦音 (キュキュキュッ)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220 + Math.random() * 50, now);
      
      gain.gain.setValueAtTime(0.05 * param, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
      break;
    }
    case 'fall': { // コース外落下 (ヒュゥゥゥン...)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.6);
      
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
      break;
    }
    case 'goal': { // ゴールファンファーレ！
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, C
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.4);
      });
      break;
    }
  }
}

// --- 3D Scene Initialization (Three.js) ---
function init3D() {
  const container = document.getElementById('canvas-container');
  container.innerHTML = ''; // Canvasをリセット
  
  // 1. Scene
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xcaf0f8); // ソーダブルーの空
  state.scene.fog = new THREE.FogExp2(0xcaf0f8, 0.012); // ふんわりとした霧効果
  
  // 2. Camera (三人称追従用)
  state.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  
  // 3. Renderer
  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(state.renderer.domElement);
  
  // 4. Lights (あたたかい雰囲気)
  const ambientLight = new THREE.AmbientLight(0xfdf6ec, 0.65); // 温かいアイボリー光
  state.scene.add(ambientLight);
  
  const sunLight = new THREE.DirectionalLight(0xffedd5, 0.85); // 暖かい太陽光
  sunLight.position.set(40, 100, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 300;
  
  // 影の投影範囲
  const d = 100;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  state.scene.add(sunLight);
  
  // 5. Build Course & Entities
  buildCourse();
  buildKart();
  spawnCoins();
  spawnDashPads();
  
  // 6. Spawn Rivals (AI)
  // スタートラインの後方に等間隔で配置
  state.rivals = [
    new RivalKart(0.97, 0x80ed99), // メロングリーン
    new RivalKart(0.94, 0xfca311), // キャラメルプリン
    new RivalKart(0.91, 0xb5179e)  // グレープパープル
  ];
  
  // カメラの初期位置をカートの背後に直接セットし、めり込みを防止
  const startBackOffset = new THREE.Vector3(0, 4.8, -12).applyQuaternion(state.kart.quaternion);
  state.camera.position.copy(state.kart.position).add(startBackOffset);
  
  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  if (state.camera && state.renderer) {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// --- Build Game Entities ---

// 🏁 コースの構築 (浮遊するサーキット)
function buildCourse() {
  const roadGroup = new THREE.Group();
  
  // 楕円形のループコースを作成するためのパス
  const courseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(30, 0, 10),
    new THREE.Vector3(60, 0, 30),
    new THREE.Vector3(70, 0, 60),
    new THREE.Vector3(50, 0, 90),
    new THREE.Vector3(0, 0, 100),
    new THREE.Vector3(-40, 0, 80),
    new THREE.Vector3(-60, 0, 50),
    new THREE.Vector3(-50, 0, 20),
    new THREE.Vector3(-20, 0, 5)
  ], true); // ループ
  
  state.courseCurve = courseCurve;
  
  // パスに沿って極太のチューブ/押し出しを作成して「道路」にする (道路幅を 8 から 12 に拡張して広くする)
  const roadGeometry = new THREE.TubeGeometry(courseCurve, 100, 12, 16, true);
  
  // 道路の材質（あたたかいビスケットアイボリー）
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0xfdf8eb,
    roughness: 0.6,
    metalness: 0.1
  });
  
  const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
  roadMesh.receiveShadow = true;
  roadGroup.add(roadMesh);
  
  // 内外にキャラメル色の「縁取りライン」を描画 (半径 12.5)
  const outerLineGeometry = new THREE.TubeGeometry(courseCurve, 100, 12.5, 8, true);
  const outerLineMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4a261, // アプリコット
    roughness: 0.5
  });
  const outerMesh = new THREE.Mesh(outerLineGeometry, outerLineMaterial);
  roadGroup.add(outerMesh);
  
  // スタート/ゴール地点のチェッカー模様の表示 (道幅に合わせて 25 に拡張)
  const startPlateGeo = new THREE.BoxGeometry(25, 0.2, 3);
  const startPlateMat = new THREE.MeshStandardMaterial({
    color: 0xe76f51, // テラコッタ
    roughness: 0.8
  });
  const startPlate = new THREE.Mesh(startPlateGeo, startPlateMat);
  startPlate.position.set(0, 0.15, 0);
  roadGroup.add(startPlate);
  
  state.scene.add(roadGroup);
}

// 🏎️ 3D カートの構築 (おもちゃ風デザイン)
function buildKart() {
  state.kart = new THREE.Group();
  state.wheels = [];
  
  // 1. シャーシ・ボディ（イチゴレッド）
  const bodyGeo = new THREE.BoxGeometry(1.6, 0.6, 2.4);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xff4d6d,
    roughness: 0.2,
    metalness: 0.1
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  state.kart.add(body);
  
  // 2. カウル・風よけ（透明なプラスチック）
  const glassGeo = new THREE.BoxGeometry(1.4, 0.4, 0.6);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcaf0f8,
    transparent: true,
    opacity: 0.6,
    roughness: 0.1
  });
  const windshield = new THREE.Mesh(glassGeo, glassMat);
  windshield.position.set(0, 0.85, 0.2);
  state.kart.add(windshield);
  
  // 3. 黄色のヘッドライト（左右）
  const lightGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe53b });
  
  const lightL = new THREE.Mesh(lightGeo, lightMat);
  lightL.position.set(-0.6, 0.45, 1.2);
  const lightR = new THREE.Mesh(lightGeo, lightMat);
  lightR.position.set(0.6, 0.45, 1.2);
  state.kart.add(lightL);
  state.kart.add(lightR);
  
  // 4. マフラー（お尻の排気口）
  const mufflerGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8);
  mufflerGeo.rotateX(Math.PI / 2);
  const mufflerMat = new THREE.MeshStandardMaterial({ color: 0x4a3e3d, roughness: 0.8 });
  const muffler = new THREE.Mesh(mufflerGeo, mufflerMat);
  muffler.position.set(0, 0.3, -1.25);
  state.kart.add(muffler);
  
  // 5. タイヤ（4つ、黒いシリンダー）
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2); // 横向きにする
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x4a3e3d, roughness: 0.9 });
  
  const wheelPos = [
    { x: -0.9, y: 0.38, z: 0.8 },  // 前左
    { x: 0.9, y: 0.38, z: 0.8 },   // 前右
    { x: -0.9, y: 0.38, z: -0.8 }, // 後左
    { x: 0.9, y: 0.38, z: -0.8 }  // 後右
  ];
  
  wheelPos.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(pos.x, pos.y, pos.z);
    wheel.castShadow = true;
    state.kart.add(wheel);
    state.wheels.push(wheel);
  });
  
  // 初期位置設定（スタートライン・道路の天頂 Y=12.4）
  state.kart.position.set(0, 12.4, 0);
  state.scene.add(state.kart);
  
  // コースのスタート地点での接線方向を向かせる
  const tangent = state.courseCurve.getTangentAt(0);
  const initialAngle = Math.atan2(tangent.x, tangent.z);
  
  // 物理の初期化
  state.physics.x = 0;
  state.physics.y = 12.4;
  state.physics.z = 0;
  state.physics.angle = initialAngle; // コース順路に向ける
  state.kart.rotation.y = initialAngle;
}

// 🪙 コース上に3Dコインを配置
function spawnCoins() {
  // コインオブジェクトをクリア
  state.coinsList.forEach(c => state.scene.remove(c));
  state.coinsList = [];
  
  const coinGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 12);
  coinGeo.rotateX(Math.PI / 2); // 立てる
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xfca311, // プリンイエロー/ゴールド
    roughness: 0.2,
    metalness: 0.8
  });
  
  // コース上の特定の点（割合 0.0〜1.0）にコインを配置
  const coinPositions = [0.08, 0.15, 0.22, 0.32, 0.45, 0.52, 0.65, 0.72, 0.83, 0.92];
  
  coinPositions.forEach(t => {
    const pos = state.courseCurve.getPointAt(t);
    const coin = new THREE.Mesh(coinGeo, coinMat);
    
    // チューブの天頂(Y=12.0)より少し浮かせ、影を落とす
    coin.position.copy(pos);
    coin.position.y += 13.0; 
    coin.castShadow = true;
    
    state.scene.add(coin);
    state.coinsList.push(coin);
  });
}

// 🚀 コース上に加速床（ダッシュ板）を配置
function spawnDashPads() {
  state.dashPads.forEach(d => state.scene.remove(d));
  state.dashPads = [];
  
  const padGeo = new THREE.BoxGeometry(3.5, 0.08, 2.2);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x80ed99, // ダッシュグリーン
    roughness: 0.3,
    emissive: 0x80ed99,
    emissiveIntensity: 0.3
  });
  
  const padPositions = [0.28, 0.58, 0.88];
  
  padPositions.forEach(t => {
    const pos = state.courseCurve.getPointAt(t);
    const pad = new THREE.Mesh(padGeo, padMat);
    
    // コースの天頂にピッタリ重ねる
    pad.position.copy(pos);
    pad.position.y += 12.08;
    
    // コースの進行方向に角度を合わせる
    const tangent = state.courseCurve.getTangentAt(t);
    const angle = Math.atan2(tangent.x, tangent.z);
    pad.rotation.y = angle;
    
    state.scene.add(pad);
    state.dashPads.push(pad);
  });
}

// --- Rival Cart (AI対戦カート) ---
class RivalKart {
  constructor(tOffset, colorHex = 0x80ed99) {
    this.t = tOffset; // 初期位置(割合)
    this.speed = 0.00075;
    this.baseSpeed = 0.00075 + Math.random() * 0.0001; // ライバルごとの個性
    this.color = colorHex;
    this.mesh = new THREE.Group();
    this.wheels = [];
    this.buildMesh();
    state.scene.add(this.mesh);
  }
  
  buildMesh() {
    // 1. ボディ
    const bodyGeo = new THREE.BoxGeometry(1.6, 0.6, 2.4);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.2,
      metalness: 0.1
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45;
    body.castShadow = true;
    this.mesh.add(body);
    
    // 2. カウル
    const glassGeo = new THREE.BoxGeometry(1.4, 0.4, 0.6);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xcaf0f8,
      transparent: true,
      opacity: 0.6
    });
    const windshield = new THREE.Mesh(glassGeo, glassMat);
    windshield.position.set(0, 0.85, 0.2);
    this.mesh.add(windshield);
    
    // 3. ライト
    const lightGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe53b });
    const lightL = new THREE.Mesh(lightGeo, lightMat);
    lightL.position.set(-0.6, 0.45, 1.2);
    const lightR = new THREE.Mesh(lightGeo, lightMat);
    lightR.position.set(0.6, 0.45, 1.2);
    this.mesh.add(lightL);
    this.mesh.add(lightR);
    
    // 4. マフラー
    const mufflerGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8);
    mufflerGeo.rotateX(Math.PI / 2);
    const mufflerMat = new THREE.MeshStandardMaterial({ color: 0x4a3e3d });
    const muffler = new THREE.Mesh(mufflerGeo, mufflerMat);
    muffler.position.set(0, 0.3, -1.25);
    this.mesh.add(muffler);
    
    // 5. タイヤ (4つ)
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x4a3e3d, roughness: 0.9 });
    
    const pos = [
      { x: -0.9, y: 0.38, z: 0.8 },
      { x: 0.9, y: 0.38, z: 0.8 },
      { x: -0.9, y: 0.38, z: -0.8 },
      { x: 0.9, y: 0.38, z: -0.8 }
    ];
    
    pos.forEach(p => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(p.x, p.y, p.z);
      wheel.castShadow = true;
      this.mesh.add(wheel);
      this.wheels.push(wheel);
    });
  }
  
  update(playerT) {
    // ラバーバンドAI (プレイヤーとの距離に応じた自動追いつき・手加減補正)
    let tDiff = playerT - this.t;
    if (tDiff < -0.5) tDiff += 1.0;
    if (tDiff > 0.5) tDiff -= 1.0;
    
    let speedMult = 1.0;
    if (tDiff > 0.05) {
      speedMult = 1.25; // 追い上げ
    } else if (tDiff < -0.05) {
      speedMult = 0.85; // 手加減
    }
    
    this.speed = this.baseSpeed * speedMult;
    this.t += this.speed;
    if (this.t > 1.0) this.t -= 1.0;
    
    // 3D座標の更新
    const pos = state.courseCurve.getPointAt(this.t);
    const tangent = state.courseCurve.getTangentAt(this.t);
    
    this.mesh.position.copy(pos);
    this.mesh.position.y = 12.4;
    
    // コースに沿って進行方向に向ける
    const angle = Math.atan2(tangent.x, tangent.z);
    this.mesh.rotation.y = angle;
    
    // タイヤ回転
    this.wheels.forEach(w => {
      w.rotation.x += this.speed * 85;
    });
    
    // ぷるぷる揺れ
    const body = this.mesh.children[0];
    if (body) {
      body.scale.y = 1.0 + Math.sin(performance.now() * 0.035) * 0.04;
    }
    
    // 煙パーティクル噴射
    if (Math.random() < 0.22) {
      const backOffset = new THREE.Vector3(0, 0.3, -1.2).applyQuaternion(this.mesh.quaternion);
      const sp = new SmokeParticle(pos.x + backOffset.x, 12.4 + backOffset.y, pos.z + backOffset.z, 0xdddddd, 0.2);
      state.scene.add(sp);
      state.particles.push(sp);
    }
  }
}

// --- Particles (煙・火花のエフェクト) ---
class SmokeParticle extends THREE.Mesh {
  constructor(x, y, z, color = 0xffffff, size = 0.28) {
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7
    });
    super(geo, mat);
    this.position.set(x, y, z);
    
    this.vx = (Math.random() - 0.5) * 0.08;
    this.vy = Math.random() * 0.04 + 0.02;
    this.vz = (Math.random() - 0.5) * 0.08;
    this.scaleSpeed = 0.94;
  }
  
  update() {
    this.position.x += this.vx;
    this.position.y += this.vy;
    this.position.z += this.vz;
    
    this.scale.multiplyScalar(this.scaleSpeed);
    this.material.opacity -= 0.015;
    
    return this.material.opacity > 0 && this.scale.x > 0.01;
  }
}

function spawnSmoke() {
  if (!state.kart) return;
  const p = state.kart.position;
  
  // カートの進行方向と逆向きに煙を噴射する
  const backOffset = new THREE.Vector3(0, 0.3, -1.2).applyQuaternion(state.kart.quaternion);
  const smokeX = p.x + backOffset.x;
  const smokeY = p.y + backOffset.y;
  const smokeZ = p.z + backOffset.z;
  
  // ドリフト中はタイヤ痕の激しい煙、通常時は排気ガス
  const count = state.keys.drift ? 3 : 1;
  const color = state.keys.drift ? 0xffbbcc : 0xffffff; // ドリフト中はファンシーなピンクの煙！
  const size = state.keys.drift ? 0.35 : 0.22;
  
  for (let i = 0; i < count; i++) {
    const sp = new SmokeParticle(smokeX, smokeY, smokeZ, color, size);
    state.scene.add(sp);
    state.particles.push(sp);
  }
}

function updateParticles() {
  state.particles = state.particles.filter(p => {
    const alive = p.update();
    if (!alive) {
      state.scene.remove(p);
    }
    return alive;
  });
}

// --- Gameplay Controls ---
function setupControls() {
  window.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        state.keys.forward = true;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        state.keys.backward = true;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        state.keys.left = true;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        state.keys.right = true;
        break;
      case ' ':
        state.keys.drift = true;
        break;
    }
    initAudio(); // ユーザー入力でオーディオ初期化
  });
  
  window.addEventListener('keyup', e => {
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        state.keys.forward = false;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        state.keys.backward = false;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        state.keys.left = false;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        state.keys.right = false;
        break;
      case ' ':
        state.keys.drift = false;
        break;
    }
  });
}

// --- Physics & Game Loop ---

function updatePhysics() {
  const p = state.physics;
  const k = state.kart;
  if (!k) return;
  
  // 1. カートがコースから落下しているかどうかの判定 (Y=12.4の道路から著しく落ちたとき)
  if (p.y < 5.0) {
    if (!p.isFalling) {
      p.isFalling = true;
      playSound('fall');
      showFloatMessage("コースアウト！ 💦", '#ff4d6d');
      
      // スタート位置にリスポーン
      setTimeout(() => {
        k.position.set(0, 12.4, 0);
        p.x = 0;
        p.y = 12.4;
        p.z = 0;
        p.vx = 0;
        p.vy = 0;
        p.vz = 0;
        p.speed = 0;
        
        const tangent = state.courseCurve.getTangentAt(0);
        const initialAngle = Math.atan2(tangent.x, tangent.z);
        p.angle = initialAngle; // スタート向き
        k.rotation.set(0, p.angle, 0);
        p.isFalling = false;
      }, 1000);
    }
  }
  
  if (p.isFalling) {
    // 落下アニメーション
    p.y += p.vy;
    p.vy += p.gravity;
    k.position.y = p.y;
    k.rotation.x += 0.05;
    k.rotation.z += 0.08;
    return;
  }
  
  // 2. 前後移動の加速計算
  if (state.keys.forward) {
    p.speed = Math.min(p.maxSpeed, p.speed + p.accel);
  } else if (state.keys.backward) {
    p.speed = Math.max(-p.maxSpeed * 0.4, p.speed - p.accel * 0.8);
  } else {
    p.speed *= p.decel; // 慣性滑走
  }
  
  // 3. 左右ハンドル＆ドリフト計算
  let currentTurnSpeed = p.turnSpeed;
  if (state.keys.drift && Math.abs(p.speed) > 0.15) {
    // スペースキー長押しでドリフト！旋回角度が大きくなり、スライドする
    currentTurnSpeed = p.turnSpeed * 1.65;
    if (Math.random() < 0.25) playSound('drift', Math.abs(p.speed));
  }
  
  if (state.keys.left) {
    p.angle += currentTurnSpeed;
  }
  if (state.keys.right) {
    p.angle -= currentTurnSpeed;
  }
  
  // 4. ドリフト慣性による滑りベクトルの適用
  const targetVx = Math.sin(p.angle) * p.speed;
  const targetVz = Math.cos(p.angle) * p.speed;
  
  // ドリフト中は目標ベクトルへの吸着（イージング）を遅くし、進行方向に滑らせる
  const gripFactor = state.keys.drift ? 0.08 : 0.22;
  p.vx += (targetVx - p.vx) * gripFactor;
  p.vz += (targetVz - p.vz) * gripFactor;
  
  // 5. 座標更新
  p.x += p.vx;
  p.z += p.vz;
  
  // --- スマートハンドルアシスト & コース端スライドクランプ ---
  // カートに最も近いコース中心線上の点(t)を探す
  let closestDist = Infinity;
  let closestT = 0;
  const closestPoint = new THREE.Vector3();
  
  // コース上の100箇所をスキャンして最短距離の点を割り出す
  for (let t = 0; t <= 1.0; t += 0.01) {
    const pt = state.courseCurve.getPointAt(t);
    const dist = Math.hypot(p.x - pt.x, p.z - pt.z); // 平面での距離
    if (dist < closestDist) {
      closestDist = dist;
      closestT = t;
      closestPoint.copy(pt);
    }
  }
  
  // 道路の許容半径（道路を広くしたため、12.0の幅に合わせて10.0に拡張）
  const roadLimit = 10.0;
  
  if (closestDist > 0.1) {
    // 道路中心からカートへの方向ベクトル (法線)
    const nx = (p.x - closestPoint.x) / closestDist;
    const nz = (p.z - closestPoint.z) / closestDist;
    
    // コースの端っこ（壁）に到達した場合
    if (closestDist > roadLimit) {
      // 1. 位置を限界距離に強制クランプ (コース外へのはみ出しを物理的にブロック)
      p.x = closestPoint.x + nx * roadLimit;
      p.z = closestPoint.z + nz * roadLimit;
      
      // 2. 速度の壁面スライド補正 (外向きの速度をゼロにし、壁に沿って滑り進ませる)
      const dot = p.vx * nx + p.vz * nz;
      if (dot > 0) {
        p.vx -= nx * dot;
        p.vz -= nz * dot;
        p.speed *= 0.98; // 壁ずり摩擦減速
      }
      
      // 火花エフェクト
      if (Math.random() < 0.15 && Math.abs(p.speed) > 0.1) {
        if (Math.random() < 0.3) playSound('drift', 0.2);
        const sp = new SmokeParticle(p.x, p.y - 0.2, p.z, 0xfca311, 0.15); // 黄色い火花
        state.scene.add(sp);
        state.particles.push(sp);
      }
    }
    
    // 3. 自動進路調整 (スマートステアリングアシスト)
    // 道路拡張に合わせ、中心線から 6.0 以上逸れたら、自動でコースの接線方向へ車の向きを徐々に補正する
    if (closestDist > 6.0) {
      const tangent = state.courseCurve.getTangentAt(closestT);
      const roadAngle = Math.atan2(tangent.x, tangent.z);
      
      // 角度の差分を -PI から PI の範囲に正規化
      let angleDiff = roadAngle - p.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      
      // コースをはみ出しそうになるほど強くハンドルアシストを介入させる
      const assistStrength = (closestDist - 6.0) * 0.015;
      p.angle += angleDiff * assistStrength;
    }
    
    // プレイヤーのコース上の現在位置(t)を記録して、ライバルAIが参照できるようにする
    state.playerT = closestT;
  }
  
  // 簡易道路高さ合わせ (Y軸は地面の高さに追従する)
  // プロトタイプコースは平面(Y=0, チューブ天頂Y=12.4)を想定
  p.y = 12.4;
  
  k.position.set(p.x, p.y, p.z);
  
  // 6. カートの向き（クォータニオン）の回転
  // ドリフト中は車体を進行方向よりさらに内側に少し傾ける (マリオカート風ドリフト姿勢)
  let visualAngle = p.angle;
  if (state.keys.drift && state.keys.left) {
    visualAngle += 0.25;
    k.rotation.z = -0.08; // 左傾き
  } else if (state.keys.drift && state.keys.right) {
    visualAngle -= 0.25;
    k.rotation.z = 0.08; // 右傾き
  } else {
    k.rotation.z = 0; // 平ら
  }
  k.rotation.y = visualAngle;
  k.rotation.x = 0;
  
  // 7. タイヤの回転アニメーション ＆ ぷるぷる縦揺れ
  state.wheels.forEach((w, idx) => {
    w.rotation.x += p.speed * 1.5; // 移動速度に合わせてタイヤ回転
  });
  
  // カートのボディを移動速度に応じてぷるぷるさせる（おもちゃのゼリー感）
  const bodyMesh = k.children[0];
  if (bodyMesh) {
    bodyMesh.scale.y = 1.0 + Math.sin(performance.now() * 0.04) * 0.05 * (Math.abs(p.speed) + 0.1);
  }
  
  // 8. 走っている時は煙パーティクルを噴射
  if (Math.abs(p.speed) > 0.05) {
    spawnSmoke();
  }
}

// 📷 カートの真後ろをスムーズに追いかける Chase Camera
function updateCamera() {
  if (!state.camera || !state.kart) return;
  
  const k = state.kart;
  const p = state.physics;
  
  // カートの背後 12ユニット、上空 4.8ユニットの位置をターゲットとする
  const backOffset = new THREE.Vector3(0, 4.8, -12).applyQuaternion(k.quaternion);
  const targetCamPos = new THREE.Vector3().copy(k.position).add(backOffset);
  
  // スムーズなカメラ補間 (イージング)
  state.camera.position.lerp(targetCamPos, 0.08);
  
  // 常にカートを捉え、少し先の進行方向を見つめる
  const lookTarget = new THREE.Vector3().copy(k.position);
  lookTarget.y += 1.2; // 車体の中央付近
  state.camera.lookAt(lookTarget);
}

// 🪙 コイン獲得 ＆ ダッシュ床との衝突判定
function checkCollisions() {
  if (!state.kart || state.physics.isFalling) return;
  const kp = state.kart.position;
  
  // 1. コインとの衝突
  state.coinsList = state.coinsList.filter(coin => {
    const dist = kp.distanceTo(coin.position);
    if (dist < 1.8) {
      // 獲得！
      state.scene.remove(coin);
      state.coins.add = (state.coins || 0); // 防御
      state.coins++;
      playSound('coin');
      
      // コイン獲得エフェクト
      for (let i = 0; i < 6; i++) {
        const sp = new SmokeParticle(coin.position.x, coin.position.y, coin.position.z, 0xfca311, 0.18);
        state.scene.add(sp);
        state.particles.push(sp);
      }
      
      updateHUD();
      return false; // リストから除外
    }
    return true;
  });
  
  // 2. 加速床（ダッシュ板）との接触
  state.dashPads.forEach(pad => {
    const dist = kp.distanceTo(pad.position);
    if (dist < 2.5) {
      // 超加速！
      state.physics.speed = state.physics.maxSpeed * 1.5;
      playSound('dash');
      
      // スピードラインのインジケータを点滅
      const speedLines = document.getElementById('speed-lines');
      if (speedLines) {
        speedLines.style.opacity = '1.0';
        setTimeout(() => { speedLines.style.opacity = '0'; }, 500);
      }
      
      // 加速の緑の星エフェクト
      for (let i = 0; i < 8; i++) {
        const sp = new SmokeParticle(kp.x, kp.y, kp.z, 0x80ed99, 0.25);
        state.scene.add(sp);
        state.particles.push(sp);
      }
    }
  });
  
  // 3. カート同士の衝突判定 (プレイヤー vs ライバル)
  if (state.rivals && state.rivals.length > 0) {
    state.rivals.forEach(rival => {
      const rp = rival.mesh.position;
      const dist = kp.distanceTo(rp);
      if (dist < 2.2) {
        // 衝突！
        playSound('hit', 1.2);
        
        // 反発方向ベクトル
        const dx = kp.x - rp.x;
        const dz = kp.z - rp.z;
        const angle = Math.atan2(dx, dz);
        
        // 反発力
        const pushForce = 0.25;
        state.physics.vx += Math.sin(angle) * pushForce;
        state.physics.vz += Math.cos(angle) * pushForce;
        state.physics.speed *= 0.88; // 衝突減速
        
        // ぷるぷる変形
        state.kart.children[0].scale.y = 0.65;
        rival.mesh.children[0].scale.y = 0.65;
        
        // 衝突火花エフェクト
        for (let i = 0; i < 6; i++) {
          const hx = (kp.x + rp.x) / 2;
          const hz = (kp.z + rp.z) / 2;
          const sp = new SmokeParticle(hx, 12.4, hz, 0xff4d6d, 0.2);
          state.scene.add(sp);
          state.particles.push(sp);
        }
      }
    });
  }
  
  // 4. ゴールラインの検知 (スタートライン X=0付近, Z=0付近, Y=12.4基準に修正)
  const distToStart = kp.distanceTo(new THREE.Vector3(0, 12.4, 0));
  if (distToStart < 4.2 && state.gameState === 'playing' && performance.now() - state.startTime > 8000) {
    // 完走！ゴール！
    finishGame();
  }
}

// --- Game Control Functions ---

function startGame() {
  initAudio();
  init3D();
  
  state.gameState = 'playing';
  state.time = 0;
  state.coins = 0;
  state.startTime = performance.now();
  
  document.getElementById('lobby-screen').classList.remove('active');
  document.getElementById('game-screen').classList.add('active');
  
  updateHUD();
  showFloatMessage("スタート！ 🏎️🏁", '#fca311');
}

function finishGame() {
  state.gameState = 'gameover';
  playSound('goal');
  
  const totalTimeMs = performance.now() - state.startTime;
  const formattedTime = formatTime(totalTimeMs);
  
  // ハイスコア（ベストタイム）の保存
  const prevBest = state.bestTimes.course1;
  let isNewBest = false;
  if (!prevBest || totalTimeMs < prevBest) {
    state.bestTimes.course1 = totalTimeMs;
    localStorage.setItem('punipuni_kart_best_course1', totalTimeMs);
    isNewBest = true;
  }
  
  updateBestTimeUI();
  
  document.getElementById('result-time').textContent = formattedTime;
  document.getElementById('result-coins').textContent = state.coins;
  
  const msgBox = document.getElementById('result-text-msg');
  if (isNewBest) {
    msgBox.innerHTML = `<span style="color: #ff4d6d; font-weight: 900; font-size: 1.15rem;">👑 ベストタイムこうしん！ 👑</span><br>おめでとうございます！最速きろくです！`;
  } else {
    msgBox.textContent = '素晴らしい走りでした！次はもっとタイムを縮めてみよう！';
  }
  
  setTimeout(() => {
    document.getElementById('gameover-dialog').showModal();
  }, 1200);
}

function quitGame() {
  state.gameState = 'lobby';
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('lobby-screen').classList.add('active');
  
  // ライバルカートのクリア
  if (state.rivals) {
    state.rivals.forEach(r => state.scene.remove(r.mesh));
    state.rivals = [];
  }
  
  // WebGLレンダラーを破棄してメモリリーク防止
  const container = document.getElementById('canvas-container');
  container.innerHTML = '';
}

function updateHUD() {
  document.getElementById('coin-val').textContent = state.coins;
  
  // 速度表示 (カートの実際の速度を適当にkm/hっぽくスケーリング)
  const kmh = Math.floor(Math.abs(state.physics.speed) * 165);
  document.getElementById('speed-val').textContent = `${kmh} km/h`;
}

function updateTimer() {
  if (state.gameState !== 'playing') return;
  const elapsed = performance.now() - state.startTime;
  document.getElementById('time-val').textContent = formatTime(elapsed);
}

function formatTime(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  const millis = Math.floor((ms % 1000) / 10);
  
  const minStr = String(minutes).padStart(2, '0');
  const secStr = String(seconds).padStart(2, '0');
  const milStr = String(millis).padStart(2, '0');
  
  return `${minStr}:${secStr}.${milStr}`;
}

function loadSettings() {
  // ベストタイムの読み込み
  const savedTime = localStorage.getItem('punipuni_kart_best_course1');
  if (savedTime) {
    state.bestTimes.course1 = parseInt(savedTime, 10);
  }
  updateBestTimeUI();
  
  // ミュートの読み込み
  const savedMute = localStorage.getItem('punipuni_kart_muted');
  state.muted = savedMute === 'true';
  updateMuteUI();
}

function updateBestTimeUI() {
  const t1 = state.bestTimes.course1;
  const bestEl = document.getElementById('best-time-1');
  if (bestEl) {
    bestEl.textContent = t1 ? formatTime(t1) : '--:--.--';
  }
}

function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem('punipuni_kart_muted', state.muted ? 'true' : 'false');
  updateMuteUI();
}

function updateMuteUI() {
  const lobbyMute = document.getElementById('lobby-mute-btn');
  const gameMute = document.getElementById('game-mute-btn');
  const icon = state.muted ? '🔇' : '🔊';
  
  if (lobbyMute) lobbyMute.textContent = icon;
  if (gameMute) gameMute.textContent = icon;
}

// 浮遊メッセージ通知
function showFloatMessage(text, color) {
  const container = document.getElementById('lap-message');
  container.textContent = text;
  container.style.color = color;
  container.classList.add('show');
  
  setTimeout(() => {
    container.classList.remove('show');
  }, 2500);
}

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  
  if (state.gameState === 'playing' || state.gameState === 'gameover') {
    // 3Dレンダリング
    updatePhysics();
    updateCamera();
    checkCollisions();
    updateParticles();
    
    // ライバルAIカートの更新
    if (state.rivals && state.rivals.length > 0) {
      state.rivals.forEach(rival => {
        rival.update(state.playerT || 0);
      });
    }
    
    // コインを自動でクルクル回転させる
    state.coinsList.forEach(c => {
      c.rotation.y += 0.04;
    });
    
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
    
    updateTimer();
    updateHUD();
  }
}

// --- DOM UI Setup ---
function setupUI() {
  const startBtn = document.querySelector('.btn-start.course1');
  const restartBtn = document.getElementById('restart-btn');
  const quitBtn = document.getElementById('quit-btn');
  const shareBtn = document.getElementById('share-btn');
  const gameoverDialog = document.getElementById('gameover-dialog');
  const lobbyMuteBtn = document.getElementById('lobby-mute-btn');
  const gameMuteBtn = document.getElementById('game-mute-btn');
  
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startGame();
    });
  }
  
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      gameoverDialog.close();
      startGame();
    });
  }
  
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      quitGame();
    });
  }
  
  const handleToggleMute = () => {
    toggleMute();
  };
  
  if (lobbyMuteBtn) lobbyMuteBtn.addEventListener('click', handleToggleMute);
  if (gameMuteBtn) gameMuteBtn.addEventListener('click', handleToggleMute);
  
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const best = state.bestTimes.course1;
      const formatted = best ? formatTime(best) : '記録なし';
      const textToCopy = `【ぷにぷにカート3D】チェッカーフラッグ！🏁\nコース1（ビギナーサーキット）を完走しました！\nタイム: ${formatted}\n集めたコイン: ${state.coins}枚\nぷるぷるの3Dカートでドリフトを決めろ！🏎️💨\n#ぷにぷにカート3D`;
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        const toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.textContent = 'スコアをコピーしたよ！';
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
          toast.classList.add('show');
        });
        
        setTimeout(() => {
          toast.classList.remove('show');
          toast.addEventListener('transitionend', () => toast.remove());
        }, 2500);
      }).catch(() => {
        alert('コピーに失敗しました。');
      });
    });
  }
}

// --- Entry Point ---
window.addEventListener('DOMContentLoaded', () => {
  setupUI();
  setupControls();
  loadSettings();
  animate();
});
