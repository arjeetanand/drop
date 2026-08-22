'use client';

import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function WaxBlob() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;
    const t = state.clock.elapsedTime;
    // Pulsing glow
    const pulse = Math.sin(t * 2) * 0.1 + 0.3;
    materialRef.current.emissiveIntensity = pulse;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <sphereGeometry args={[0.6, 64, 64]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#8B2D2D"
        roughness={0.3}
        metalness={0.1}
        emissive="#6B1F1F"
        emissiveIntensity={0.3}
      />
    </mesh>
  );
}

function WaxParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  const count = 200;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.8 + 0.3;
      const height = (Math.random() - 0.5) * 0.4;
      arr[i * 3] = Math.cos(angle) * radius;
      arr[i * 3 + 1] = height;
      arr[i * 3 + 2] = Math.sin(angle) * radius;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return geo;
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const t = state.clock.elapsedTime;
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const offset = i * 3;
      positions[offset + 1] += Math.sin(t * 3 + i) * 0.002;
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={0.04}
        color="#C04040"
        transparent
        opacity={0.7}
        sizeAttenuation
      />
    </points>
  );
}

function SealStamp({ pressed }: { pressed: boolean }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const targetY = pressed ? -0.5 : 0.5;
    groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.08;
  });

  return (
    <group ref={groupRef} position={[0, 0.5, 0]}>
      {/* Stamp handle */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.6, 16]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.6} />
      </mesh>
      {/* Stamp base */}
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.1, 32]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Heart shape on stamp */}
      <mesh position={[0, -0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#1a1c1b" roughness={0.4} />
      </mesh>
    </group>
  );
}

function Envelope() {
  return (
    <mesh position={[0, -0.3, 0]} rotation={[0.3, 0, 0]}>
      <boxGeometry args={[1.8, 0.05, 1.2]} />
      <meshStandardMaterial color="#F5ECD7" roughness={0.8} />
    </mesh>
  );
}

export function WaxSealScene({ onPressed }: { onPressed?: () => void }) {
  const [pressed, setPressed] = useState(false);

  const handlePress = () => {
    if (pressed) return;
    setPressed(true);
    onPressed?.();
  };

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 0.5, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.3} color="#ffeed0" />
        <pointLight position={[2, 3, 2]} intensity={0.8} color="#ffcc88" />
        <pointLight position={[-2, 1, -1]} intensity={0.4} color="#ff8866" />

        <Envelope />
        <WaxBlob />
        <WaxParticles />
        <SealStamp pressed={pressed} />

        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={6}
          autoRotate
          autoRotateSpeed={0.5}
        />
      </Canvas>

      <button
        type="button"
        onClick={handlePress}
        disabled={pressed}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-wax-red px-xl py-md font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-all hover:-translate-y-0.5 hover:bg-wax-red-dark hover:shadow-lg disabled:cursor-default disabled:bg-wax-red/60"
      >
        {pressed ? 'Seal pressed' : 'Press the seal'}
      </button>
    </div>
  );
}
