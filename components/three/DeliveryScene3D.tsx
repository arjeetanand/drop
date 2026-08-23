'use client';

import { useRef, useState, Suspense, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Envelope3D, House3D } from '@/components/three/Models';

function TravelingEnvelope({ progress }: { progress: number }) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current) return;
    // Travel from left to the house on the right
    const x = -3 + progress * 5;
    const y = 0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.15;
    ref.current.position.set(x, y, 0.5);
    ref.current.rotation.z = -0.1 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
    if (progress >= 0.95) {
      ref.current.visible = false;
    }
  });

  if (progress >= 0.95) return null;

  return (
    <group ref={ref}>
      <Envelope3D scale={0.4} flapOpen={0} />
    </group>
  );
}

function SceneContent({ onComplete }: { onComplete?: () => void }) {
  const [progress, setProgress] = useState(0);
  const completeRef = useRef(false);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 3000;
    const animate = (t: number) => {
      const elapsed = t - start;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(animate);
      } else if (!completeRef.current) {
        completeRef.current = true;
        onComplete?.();
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  return (
    <>
      <ambientLight intensity={0.7} color="#FFF4E6" />
      <directionalLight position={[3, 5, 3]} intensity={1.0} color="#FFE8C0" castShadow />
      <directionalLight position={[-2, 3, -1]} intensity={0.2} color="#A8D5E8" />

      {/* Ground */}
      <mesh position={[0, -1.5, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial color="#DCE9D5" roughness={0.9} />
      </mesh>

      {/* House on the right */}
      <group position={[1.8, -0.8, 0]}>
        <House3D />
      </group>

      {/* Traveling envelope */}
      <TravelingEnvelope progress={progress} />

      {/* Sparkles at destination when arriving */}
      {progress > 0.8 && (
        <mesh position={[1.8, 0, 0.8]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial
            color="#E8A838"
            emissive="#E8A838"
            emissiveIntensity={2}
          />
        </mesh>
      )}
    </>
  );
}

export function DeliveryScene3D({ onComplete }: { onComplete?: () => void }) {
  return (
    <div className="scene3d-container scene-light-bg">
      <Canvas
        shadows
        camera={{ position: [0, 1.5, 6.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContent onComplete={onComplete} />
        </Suspense>
      </Canvas>
    </div>
  );
}
