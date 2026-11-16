import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const host = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111516');

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(0, 1.2, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;

let cloud;
let initialCamera;
let initialTarget;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const coordReadout = document.querySelector('#coord-readout');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const commandStatus = document.querySelector('#command-status');
let coordinateMode = false;

const loader = new PLYLoader();
const loadRoom = (url, fallback = false) => loader.load(
  url,
  (geometry) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
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
    cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    scene.add(cloud);

    const span = Math.max(size.x, size.y, size.z, 0.1);
    camera.position.set(span * 0.95, span * 0.55, span * 1.35);
    camera.near = Math.max(span / 1000, 0.001);
    camera.far = span * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = span * 0.08;
    controls.maxDistance = span * 12;
    // 几何已平移到包围盒中点，因此原点就是房间模型的中间点。
    controls.target.set(0, 0, 0);
    controls.update();
    initialCamera = camera.position.clone();
    initialTarget = controls.target.clone();
    loading.remove();
  },
  (event) => {
    if (event.total > 0) loading.lastElementChild.textContent = `正在载入空间… ${Math.round(event.loaded / event.total * 100)}%`;
  },
  (err) => {
    console.error(err);
    if (!fallback) {
      loadRoom('./public/models/room.ply', true);
      return;
    }
    loading.remove();
    errorBox.hidden = false;
    errorBox.textContent = '模型未能载入。请确认 public/models/room.ply 文件存在，并通过本地开发服务器打开网页。';
  },
);
loadRoom('./models/room.ply');

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!coordinateMode || !cloud) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.params.Points.threshold = Math.max(cloud.material.size * 2, 0.01);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(cloud)[0];
  if (!hit) {
    coordReadout.textContent = '附近没有点，请放大后再试';
    return;
  }
  const p = hit.point;
  coordReadout.textContent = `模型坐标（已居中）：X ${p.x.toFixed(3)} · Y ${p.y.toFixed(3)} · Z ${p.z.toFixed(3)}`;
});

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  const pointCommand = command.match(/^\/point\s+([0-9]*\.?[0-9]+)$/i);
  if (pointCommand) {
    const value = Number(pointCommand[1]);
    if (!cloud || !Number.isFinite(value) || value <= 0) {
      commandStatus.textContent = '点大小需要是大于 0 的数字，且模型已载入。';
    } else {
      cloud.material.size = value;
      commandStatus.textContent = `点大小已设为 ${value}。`;
    }
  } else if (/^\/coor\s+on$/i.test(command)) {
    coordinateMode = true;
    coordReadout.hidden = false;
    coordReadout.textContent = '坐标读取已开启：点击模型上的一点';
    commandStatus.textContent = '坐标读取已开启。点击模型上的一点查看坐标。';
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

document.querySelector('#reset-view').addEventListener('click', () => {
  if (!initialCamera) return;
  camera.position.copy(initialCamera);
  controls.target.copy(initialTarget);
  controls.update();
});

function resize() {
  const width = host.clientWidth;
  const height = host.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
new ResizeObserver(resize).observe(host);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
