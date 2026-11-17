import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const host = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const entryScreen = document.querySelector('#entry-screen');
const entryTitle = document.querySelector('#entry-title');
const entryCopy = document.querySelector('#entry-copy');
const enterButton = document.querySelector('#enter-button');
const debugBackdrop = document.querySelector('#debug-backdrop');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const commandStatus = document.querySelector('#command-status');
const coordReadout = document.querySelector('#coord-readout');
const crosshair = document.querySelector('#crosshair');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111516');
scene.add(new THREE.HemisphereLight(0xe7eee4, 0x292b26, 1.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(2, -3, 5);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 100);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '房间漫游画面');
host.appendChild(renderer.domElement);

const assetUrl = (path) => new URL(`./assets/${path}`, document.baseURI).href;
const roomLoader = new PLYLoader();
const coordinateRaycaster = new THREE.Raycaster();
const objectRaycaster = new THREE.Raycaster();
const centerPointer = new THREE.Vector2(0, 0);
const cameraDirection = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();

const audioListener = new THREE.AudioListener();
camera.add(audioListener);
const sound = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();

let roomCloud = null;
let interactiveModel = null;
let coordinateMode = false;
let debugOpen = false;
let hasStarted = false;
let introPlaying = false;
let introStartTime = 0;
let previousFrameTime = 0;
let yaw = Math.PI; // 朝向房间前墙（Y 轴负方向）。
let pitch = 0;
let floorZ = -1.364;
let pointSize = 0.009;
const pressedKeys = new Set();
const WALK_LIMITS = { minX: -0.65, maxX: 0.60, minY: -0.68, maxY: 0.75 };
const START_X = 0.404;
const START_Y = 0.540;
const EYE_HEIGHT = 1.6;
const INTRO_MS = 3800;
const MOVE_SPEED = 0.82;
const LOOK_SENSITIVITY = 0.0022;

function updateCameraLook() {
  const cosPitch = Math.cos(pitch);
  cameraDirection.set(
    Math.sin(yaw) * cosPitch,
    Math.cos(yaw) * cosPitch,
    Math.sin(pitch)
  );
  cameraTarget.copy(camera.position).add(cameraDirection);
  camera.lookAt(cameraTarget);
}

function showEntry(resume = false) {
  entryTitle.textContent = resume ? '继续漫游' : '进入房间';
  entryCopy.textContent = resume
    ? '点击画面恢复鼠标视角。按 / 可打开调试指令。'
    : '点击开始漫游。使用 WASD 移动，移动鼠标环视。';
  enterButton.textContent = resume ? '继续漫游' : '开始漫游';
  entryScreen.hidden = false;
  crosshair.hidden = true;
}

function beginIntro() {
  if (introPlaying) return;
  introPlaying = true;
  introStartTime = performance.now();
  camera.position.set(START_X, START_Y, floorZ + 0.48);
  yaw = Math.PI;
  pitch = 0;
  updateCameraLook();
}

function loadRoomFrom(paths, index = 0) {
  if (index >= paths.length) {
    loading.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = '房间模型未能载入。请确认 public/models/room.ply 文件存在。';
    return;
  }

  roomLoader.load(
    paths[index],
    (geometry) => {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);

      const hasColors = geometry.hasAttribute('color');
      pointSize = Math.max(size.length() / 480, 0.003);
      const material = new THREE.PointsMaterial({
        size: pointSize,
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

      camera.near = 0.01;
      camera.far = Math.max(size.length() * 20, 100);
      camera.updateProjectionMatrix();
      loading.hidden = true;
      beginIntro();
    },
    undefined,
    (error) => {
      console.warn(`房间模型路径不可用：${paths[index]}`, error);
      loadRoomFrom(paths, index + 1);
    }
  );
}

// 兼容 GitHub 仓库直接发布（public/models）和 Vite 构建发布（models）。
loadRoomFrom(['./models/room.ply', './public/models/room.ply']);

const modelDirectory = assetUrl('INMOBJECT1/');
const mtlLoader = new MTLLoader();
mtlLoader.setPath(modelDirectory);
mtlLoader.load(
  'INMOBJECT1.mtl',
  (materials) => {
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath(modelDirectory);
    objLoader.load(
      'INMOBJECT1.obj',
      (object) => {
        interactiveModel = object;
        interactiveModel.position.set(START_X, START_Y, floorZ);
        // 模型文件使用 Y 轴朝上时，旋转到房间的 Z 轴向上坐标系。
        interactiveModel.rotation.x = Math.PI / 2;
        interactiveModel.scale.setScalar(1);
        scene.add(interactiveModel);
      },
      undefined,
      (error) => console.error('OBJ 模型载入失败：', error)
    );
  },
  undefined,
  (error) => console.error('MTL 材质载入失败：', error)
);

audioLoader.load(
  assetUrl('INMSOUND1.mp3'),
  (buffer) => {
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(1);
  },
  undefined,
  (error) => console.error('音频载入失败：', error)
);

function updateCoordinateReadout() {
  if (!coordinateMode || !roomCloud) return;
  coordinateRaycaster.params.Points.threshold = Math.max(pointSize * 2, 0.012);
  coordinateRaycaster.setFromCamera(centerPointer, camera);
  const hit = coordinateRaycaster.intersectObject(roomCloud)[0];
  coordReadout.textContent = hit
    ? `X ${hit.point.x.toFixed(3)} · Y ${hit.point.y.toFixed(3)} · Z ${hit.point.z.toFixed(3)}`
    : '准心附近没有点';
}

function toggleSound() {
  if (!sound.buffer) {
    commandStatus.textContent = '音频仍在载入，请稍后再点击物件。';
    return;
  }
  const toggle = () => {
    if (sound.isPlaying) {
      sound.pause();
      commandStatus.textContent = '音频已暂停';
    } else {
      sound.play();
      commandStatus.textContent = '正在播放物件音频';
    }
  };
  if (audioListener.context.state === 'suspended') {
    audioListener.context.resume().then(toggle).catch((error) => console.error('音频无法启动：', error));
  } else {
    toggle();
  }
}

function interactAtCrosshair() {
  if (coordinateMode) {
    updateCoordinateReadout();
    return;
  }
  if (!interactiveModel) return;
  objectRaycaster.setFromCamera(centerPointer, camera);
  if (objectRaycaster.intersectObject(interactiveModel, true).length > 0) toggleSound();
}

function openDebug() {
  if (debugOpen) return;
  debugOpen = true;
  debugBackdrop.hidden = false;
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  crosshair.hidden = true;
  commandInput.value = '';
  commandInput.focus();
}

function closeDebug() {
  if (!debugOpen) return;
  debugOpen = false;
  debugBackdrop.hidden = true;
  if (hasStarted) showEntry(true);
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  const pointCommand = command.match(/^\/point\s+([0-9]*\.?[0-9]+)$/i);

  if (pointCommand) {
    const value = Number(pointCommand[1]);
    if (!roomCloud || !Number.isFinite(value) || value <= 0) {
      commandStatus.textContent = '请输入大于 0 的点大小。';
    } else {
      pointSize = value;
      roomCloud.material.size = value;
      commandStatus.textContent = `点大小已设为 ${value}。`;
    }
  } else if (/^\/coor\s+on$/i.test(command)) {
    coordinateMode = true;
    coordReadout.hidden = false;
    updateCoordinateReadout();
    commandStatus.textContent = '坐标读取已开启：准心瞄准点云并点击读取。';
  } else if (/^\/coor\s+off$/i.test(command)) {
    coordinateMode = false;
    coordReadout.hidden = true;
    commandStatus.textContent = '坐标读取已关闭。';
  } else {
    commandStatus.textContent = '未识别命令。可用：/point X、/coor on、/coor off';
  }
  commandInput.value = '';
  commandInput.focus();
});

document.querySelector('#close-debug').addEventListener('click', closeDebug);
debugBackdrop.addEventListener('pointerdown', (event) => {
  if (event.target === debugBackdrop) closeDebug();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !debugOpen && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    openDebug();
    return;
  }
  if (event.key === 'Escape' && debugOpen) {
    event.preventDefault();
    closeDebug();
    return;
  }
  if (debugOpen || !hasStarted) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
    pressedKeys.add(key);
  }
  if (event.code === 'Space') event.preventDefault();
});

document.addEventListener('keyup', (event) => pressedKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => pressedKeys.clear());

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement || debugOpen) return;
  yaw += event.movementX * LOOK_SENSITIVITY;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * LOOK_SENSITIVITY, -1.42, 1.42);
  updateCameraLook();
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || document.pointerLockElement !== renderer.domElement || debugOpen) return;
  interactAtCrosshair();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hasStarted = true;
    entryScreen.hidden = true;
    crosshair.hidden = false;
  } else {
    pressedKeys.clear();
    crosshair.hidden = true;
    if (hasStarted && !debugOpen) showEntry(true);
  }
});

async function requestPointerLock() {
  try {
    const result = renderer.domElement.requestPointerLock();
    if (result && typeof result.then === 'function') await result;
    if (audioListener.context.state === 'suspended') await audioListener.context.resume();
  } catch (error) {
    entryCopy.textContent = '浏览器未能启用鼠标锁定，请点击画面重试。';
    console.warn('鼠标锁定未能启动：', error);
  }
}

enterButton.addEventListener('click', requestPointerLock);
entryScreen.addEventListener('click', (event) => {
  if (event.target === entryScreen) requestPointerLock();
});

function movePlayer(deltaSeconds) {
  if (!hasStarted || document.pointerLockElement !== renderer.domElement || debugOpen) return;
  let forward = 0;
  let strafe = 0;
  if (pressedKeys.has('w')) forward += 1;
  if (pressedKeys.has('s')) forward -= 1;
  if (pressedKeys.has('d')) strafe += 1;
  if (pressedKeys.has('a')) strafe -= 1;
  if (forward === 0 && strafe === 0) return;

  const length = Math.hypot(forward, strafe);
  forward /= length;
  strafe /= length;
  const distance = MOVE_SPEED * deltaSeconds;
  const dx = (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * distance;
  const dy = (Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * distance;
  // 将活动区域收在扫描房间的地面范围内，并留出墙边缓冲。
  camera.position.x = THREE.MathUtils.clamp(camera.position.x + dx, WALK_LIMITS.minX, WALK_LIMITS.maxX);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y + dy, WALK_LIMITS.minY, WALK_LIMITS.maxY);
}

function resize() {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
new ResizeObserver(resize).observe(host);
resize();

renderer.setAnimationLoop((time) => {
  const deltaSeconds = previousFrameTime ? Math.min((time - previousFrameTime) / 1000, 0.05) : 0;
  previousFrameTime = time;

  if (introPlaying) {
    const t = THREE.MathUtils.clamp((time - introStartTime) / INTRO_MS, 0, 1);
    const eased = t * t * (3 - 2 * t);
    camera.position.set(START_X, START_Y - 0.22 * eased, floorZ + 0.48 + (EYE_HEIGHT - 0.48) * eased);
    updateCameraLook();
    if (t >= 1) {
      introPlaying = false;
      showEntry(false);
    }
  } else {
    movePlayer(deltaSeconds);
    if (coordinateMode) updateCoordinateReadout();
  }
  renderer.render(scene, camera);
});
