import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  BULLET_IMPACT_MARK_RADIUS,
  MAX_BLOOD_SPLAT_MARKS,
  MAX_BULLET_IMPACT_MARKS,
  type BloodSplatMark,
  type BulletImpactMark,
} from "./scene-constants";

const _bloodGeometry = new THREE.CircleGeometry(1, 10);
const _bloodMaterial = new THREE.MeshBasicMaterial({
  color: "#7c0c0c",
  transparent: true,
  opacity: 1,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const _bulletGeometry = new THREE.CircleGeometry(BULLET_IMPACT_MARK_RADIUS, 10);
const _bulletMaterial = new THREE.MeshBasicMaterial({
  color: "#1f1f1f",
  transparent: true,
  opacity: 0.82,
  depthWrite: false,
});

const _instanceMatrix = new THREE.Matrix4();
const _instancePosition = new THREE.Vector3();
const _instanceQuaternion = new THREE.Quaternion();
const _instanceScale = new THREE.Vector3();

export function BloodImpactMarks({ impacts }: { impacts: BloodSplatMark[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const opacitiesRef = useRef<Float32Array>(new Float32Array(MAX_BLOOD_SPLAT_MARKS));

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < impacts.length; i++) {
      const impact = impacts[i];
      _instancePosition.set(impact.position[0], impact.position[1], impact.position[2]);
      _instanceQuaternion.set(impact.quaternion[0], impact.quaternion[1], impact.quaternion[2], impact.quaternion[3]);
      _instanceScale.setScalar(impact.radius);
      _instanceMatrix.compose(_instancePosition, _instanceQuaternion, _instanceScale);
      mesh.setMatrixAt(i, _instanceMatrix);
      opacitiesRef.current[i] = impact.opacity;
    }

    mesh.count = impacts.length;
    mesh.instanceMatrix.needsUpdate = true;

    const geo = mesh.geometry;
    const attr = geo.getAttribute("instanceOpacity");
    if (attr) {
      (attr.array as Float32Array).set(opacitiesRef.current.subarray(0, impacts.length));
      attr.needsUpdate = true;
    }
  }, [impacts]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const geo = mesh.geometry;
    if (!geo.getAttribute("instanceOpacity")) {
      geo.setAttribute(
        "instanceOpacity",
        new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOOD_SPLAT_MARKS), 1),
      );
    }
    mesh.material = _bloodMaterial.clone();
    (mesh.material as THREE.MeshBasicMaterial).onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float instanceOpacity;\nvarying float vInstanceOpacity;\nvoid main() {\nvInstanceOpacity = instanceOpacity;");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vInstanceOpacity;\nvoid main() {")
        .replace("#include <output_fragment>", "#include <output_fragment>\ngl_FragColor.a *= vInstanceOpacity;");
    };
  }, []);

  return (
    <instancedMesh
      ref={meshRef}
      args={[_bloodGeometry, undefined, MAX_BLOOD_SPLAT_MARKS]}
      frustumCulled={false}
      renderOrder={4}
    />
  );
}

export function BulletImpactMarks({ impacts }: { impacts: BulletImpactMark[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < impacts.length; i++) {
      const impact = impacts[i];
      _instancePosition.set(impact.position[0], impact.position[1], impact.position[2]);
      _instanceQuaternion.set(impact.quaternion[0], impact.quaternion[1], impact.quaternion[2], impact.quaternion[3]);
      _instanceScale.set(1, 1, 1);
      _instanceMatrix.compose(_instancePosition, _instanceQuaternion, _instanceScale);
      mesh.setMatrixAt(i, _instanceMatrix);
    }

    mesh.count = impacts.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [impacts]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[_bulletGeometry, _bulletMaterial, MAX_BULLET_IMPACT_MARKS]}
      frustumCulled={false}
      renderOrder={3}
    />
  );
}
