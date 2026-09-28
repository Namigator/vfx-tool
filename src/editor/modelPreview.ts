// 10 "For GLB show meter scale, rotate/fit preview": parses a validated GLB once, measures its bounding box in
// file units and renders a fitted three-quarter thumbnail with a short-lived renderer (disposed right after,
// so no WebGL context is kept). Browser-only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ModelPreview = { size: [number, number, number]; thumbnail: string };

export async function previewGlb(bytes: Uint8Array, px = 192): Promise<ModelPreview> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene), size = new THREE.Vector3(), centre = new THREE.Vector3();
  box.getSize(size); box.getCenter(centre);
  const radius = Math.max(1e-6, size.length() / 2);
  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
  camera.position.copy(centre).add(new THREE.Vector3(1, 0.8, 1.3).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.05));
  camera.lookAt(centre);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.copy(camera.position).add(new THREE.Vector3(radius, radius * 2, 0));
  scene.add(key);
  scene.background = new THREE.Color(0x151922);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(px, px, false);
    renderer.render(scene, camera);
    return { size: [size.x, size.y, size.z], thumbnail: renderer.domElement.toDataURL('image/png') };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    gltf.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); } });
  }
}
