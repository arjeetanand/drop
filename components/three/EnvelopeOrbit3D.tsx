'use client';

import { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Envelope3D } from '@/components/three/Models';

function FloatingEnvelope() {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = Math.sin(t * 0.5) * 0.4;
    ref.current.rotation.x = Math.cos(t * 0.4) * 0.15;
    ref.current.position.y = Math.sin(t * 0.8) * 0.2;
  });

  return (
    <group ref={ref}>
      <Envelope3D scale={0.9} flapOpen={0} />
    </group>
  );
}

function Sparkles3D() {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  const positions: Array<[number, number, number]> = [
    [2, 1.5, 0],
    [-2, 1.2, 0.5],
    [1.5, -1, -0.5],
    [-1.5, -0.8, 0.8],
    [0, 2, 1],
  ];

  return (
    <group ref={ref}>
      {positions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? '#E8A838' : '#7DD3AE'}
            emissive={i % 2 === 0 ? '#E8A838' : '#7DD3AE'}
            emissiveIntensity={1.5}
          />
        </mesh>
      ))}
    </group>
  );
}

export function EnvelopeOrbit3D({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? 'h-40 w-full' : 'h-72 w-full max-w-[480px]'}
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [0, 0.5, 4], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} color="#FFF4E6" />
          <directionalLight position={[3, 5, 3]} intensity={1.0} color="#FFE8C0" />
          <directionalLight position={[-2, 3, -2]} intensity={0.2} color="#A8D5E8" />
          <FloatingEnvelope />
          <Sparkles3D />
        </Suspense>
      </Canvas>
    </div>
  );
}
