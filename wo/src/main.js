import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 页面元素
const host = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const coordReadout = document.querySelector('#coord-readout');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const commandStatus = document.querySelector('#command-status');

// 场景
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111516');

// OBJ/MTL 常用材质需要灯光
scene.add(new THREE.AmbientLight(0xffffff, 1.5));

const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(2, -3, 5);
scene.add(keyLight);

// 相机：房间模型的 Z 轴朝上
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.up.set(0, 0, 1);

// 渲染器
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);

// 鼠标控制
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;

// 状态
let roomCloud = null;
let interactiveModel = null;
let initialCamera = null;
let initialTarget = null;
let coordinateMode = false;
let pointerStart = null;

const coordinateRaycaster = new THREE.Raycaster();
const clickRaycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// 音频
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const sound = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();

// 资源路径相对于网页入口。
// 如果网页地址为 /wo/，此函数会访问 /wo/assets/ 下的文件。
const assetUrl = (path) => new URL(`./assets/${path}`, document.baseURI).href;

// 加载房间 PLY
const plyLoader = new PLYLoader();

function loadRoom(url, fallback = false) {
  plyLoader.load(
    url,
    (geometry) => {
      geometry.computeBoundingBox();

      const box = geometry.boundingBox;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      // 将房间包围盒中心移到坐标原点。
      // /coor on 显示的坐标和物件位置都使用这个居中坐标系。
      geometry.translate(-center.x, -center.y, -center.z);

      const hasColors = geometry.hasAttribute('color');

      const material = new THREE.PointsMaterial({
        size: Math.max(size.length() / 480, 0.003),
        sizeAttenuation: true,
        vertexColors: hasColors,
        color: hasColors ? 0xffffff : 0xc9ddd2,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      });

      roomCloud = new THREE.Points(geometry, material);
      roomCloud.frustumCulled = false;
      scene.add(roomCloud);

      const span = Math.max(size.x, size.y, size.z, 0.1);

      camera.near = Math.max(span / 1000, 0.001);
      camera.far = span * 100;
      camera.updateProjectionMatrix();

      controls.minDistance = span * 0.08;
      controls.maxDistance = span * 12;

      // 地板两点的中点估算值；若想绕房间中心旋转，可改为 (0, 0, 0)。
      const target = new THREE.Vector3(0.404, 0.540, -1.364);
      controls.target.copy(target);

      // 从前墙外侧（负 Y 方向）朝房间看。
      camera.position.set(
        target.x,
        target.y - span * 2,
        target.z + span * 0.5
      );

      controls.update();

      initialCamera = camera.position.clone();
      initialTarget = controls.target.clone();

      loading.remove();

      if (commandStatus) {
        commandStatus.textContent = '房间点云已载入';
      }
    },
    (event) => {
      if (event.total > 0 && loading.lastElementChild) {
        const percent = Math.round((event.loaded / event.total) * 100);
        loading.lastElementChild.textContent = `正在载入空间… ${percent}%`;
      }
    },
    (error) => {
      console.error('PLY 房间模型加载失败：', error);

      if (!fallback) {
        loadRoom('./public/models/room.ply', true);
        return;
      }

      loading.remove();
      errorBox.hidden = false;
      errorBox.textContent =
        '房间模型未能载入。请确认房间文件位于 public/models/room.ply。';
    }
  );
}

// 兼容构建部署和直接发布仓库文件
loadRoom('./models/room.ply');

// 加载 OBJ 和 MTL。
// MTL 文件中的 textures/xxx.jpg 会相对于这个模型文件夹查找。
const objectDirectory = assetUrl('INMOBJECT1/');

const mtlLoader = new MTLLoader();
mtlLoader.setPath(objectDirectory);

mtlLoader.load(
  'INMOBJECT1.mtl',
  (materials) => {
    materials.preload();

    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath(objectDirectory);

    objLoader.load(
      'INMOBJECT1.obj',
      (object) => {
        interactiveModel = object;

        // 示例位置：可替换为 /coor on 读取到的坐标。
        interactiveModel.position.set(0.404, 0.540, -1.364);

        // 若物件模型按 Y 轴朝上导出，旋转以适配 Z 轴朝上的房间。
        // 如果模型已经是 Z 轴朝上，可改为 0。
        interactiveModel.rotation.x = Math.PI / 2;

        // 按实际房间比例调整。
        interactiveModel.scale.setScalar(1);

        scene.add(interactiveModel);

        if (commandStatus) {
          commandStatus.textContent = '房间与可交互物件已载入';
        }
      },
      undefined,
      (error) => {
        console.error('OBJ 模型加载失败：', error);

        if (commandStatus) {
          commandStatus.textContent =
            '物件未载入：请检查 assets/INMOBJECT1/INMOBJECT1.obj。';
        }
      }
    );
  },
  undefined,
  (error) => {
    console.error('MTL 材质加载失败：', error);

    if (commandStatus) {
      commandStatus.textContent =
        '材质未载入：请检查 MTL 文件和 textures 文件夹。';
    }
  }
);

// 加载点击后播放的 MP3
audioLoader.load(
  assetUrl('INMSOUND1.mp3'),
  (buffer) => {
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(1);
  },
  undefined,
  (error) => {
    console.error('音频加载失败：', error);

    if (commandStatus) {
      commandStatus.textContent =
        '音频未载入：请检查 assets/INMSOUND1.mp3。';
    }
  }
);

// 开启 /coor on 后，点击点云读取坐标
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!coordinateMode || !roomCloud) return;

  const rect = renderer.domElement.getBoundingClientRect();

  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  coordinateRaycaster.params.Points.threshold = Math.max(
    roomCloud.material.size * 2,
    0.01
  );

  coordinateRaycaster.setFromCamera(pointer, camera);

  const hit = coordinateRaycaster.intersectObject(roomCloud)[0];

  if (!hit) {
    coordReadout.textContent = '附近没有点，请放大后再试';
    return;
  }

  const point = hit.point;

  coordReadout.textContent =
    `模型坐标（已居中）：X ${point.x.toFixed(3)} · ` +
    `Y ${point.y.toFixed(3)} · Z ${point.z.toFixed(3)}`;
});

// 记录鼠标按下位置，以区分点击物件和拖动视角
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  pointerStart = {
    x: event.clientX,
    y: event.clientY,
  };
});

// 点击 OBJ 物件时播放音频
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerStart) return;

  const start = pointerStart;
  pointerStart = null;

  // 坐标读取模式中，点击用于读取点云坐标，不触发音频。
  if (coordinateMode || !interactiveModel) return;

  const moved = Math.hypot(
    event.clientX - start.x,
    event.clientY - start.y
  );

  // 拖动画面不算点击。
  if (moved > 6) return;

  const rect = renderer.domElement.getBoundingClientRect();

  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  clickRaycaster.setFromCamera(pointer, camera);

  // recursive=true 会检测 OBJ 下面的子网格。
  const hits = clickRaycaster.intersectObject(interactiveModel, true);

  if (hits.length === 0) return;

  if (!sound.buffer) {
    if (commandStatus) {
      commandStatus.textContent = '音频仍在载入，请稍后再点击。';
    }
    return;
  }

  const playSound = () => {
    if (sound.isPlaying) {
      sound.stop();
    }
    sound.play();
  };

  // 浏览器通常要求用户操作触发音频播放。
  if (audioListener.context.state === 'suspended') {
    audioListener.context
      .resume()
      .then(playSound)
      .catch((error) => console.error('无法启动音频：', error));
  } else {
    playSound();
  }

  if (commandStatus) {
    commandStatus.textContent = '已播放物件音频';
  }
});

// 命令：/point X、/coor on、/coor off
commandForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const command = commandInput.value.trim();
  const pointCommand = command.match(/^\/point\s+([0-9]*\.?[0-9]+)$/i);

  if (pointCommand) {
    const value = Number(pointCommand[1]);

    if (!roomCloud || !Number.isFinite(value) || value <= 0) {
      commandStatus.textContent =
        '点大小需要是大于 0 的数字，且房间模型已载入。';
    } else {
      roomCloud.material.size = value;
      commandStatus.textContent = `点大小已设为 ${value}。`;
    }
  } else if (/^\/coor\s+on$/i.test(command)) {
    coordinateMode = true;
    coordReadout.hidden = false;
    coordReadout.textContent = '坐标读取已开启：点击点云上的一点';
    commandStatus.textContent = '坐标读取已开启。';
  } else if (/^\/coor\s+off$/i.test(command)) {
    coordinateMode = false;
    coordReadout.hidden = true;
    commandStatus.textContent = '坐标读取已关闭。';
  } else {
    commandStatus.textContent =
      '未识别命令。可用：/point X、/coor on、/coor off';
  }

  commandInput.value = '';
  commandInput.focus();
});

// 重置到模型加载完成时的视角
document.querySelector('#reset-view').addEventListener('click', () => {
  if (!initialCamera || !initialTarget) return;

  camera.position.copy(initialCamera);
  controls.target.copy(initialTarget);
  controls.update();
});

// 窗口尺寸变化时调整画布
function resize() {
  const width = host.clientWidth;
  const height = host.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

new ResizeObserver(resize).observe(host);
resize();

// 渲染循环
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
