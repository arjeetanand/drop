'use client';

import { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function Postbox({ shaking }: { shaking: boolean }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    if (shaking) {
      const t = state.clock.elapsedTime;
      groupRef.current.rotation.z = Math.sin(t * 30) * 0.02;
      groupRef.current.position.x = Math.sin(t * 25) * 0.03;
    } else {
      groupRef.current.rotation.z += (0 - groupRef.current.rotation.z) * 0.1;
      groupRef.current.position.x += (0 - groupRef.current.position.x) * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Main body */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 2, 32]} />
        <meshStandardMaterial color="#8B2D2D" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Top cap */}
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.55, 0.5, 0.2, 32]} />
        <meshStandardMaterial color="#6B1F1F" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* Top dome */}
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#8B2D2D" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Slot */}
      <mesh position={[0, 0.7, 0.5]}>
        <boxGeometry args={[0.3, 0.04, 0.02]} />
        <meshStandardMaterial color="#1a1c1b" roughness={0.8} />
      </mesh>
      {/* Door */}
      <mesh position={[0, -0.3, 0.49]}>
        <boxGeometry args={[0.3, 0.6, 0.02]} />
        <meshStandardMaterial color="#6B1F1F" roughness={0.3} metalness={0.5} />
      </mesh>
      {/* "POST" plate */}
      <mesh position={[0, 0.85, 0.51]}>
        <boxGeometry args={[0.25, 0.08, 0.01]} />
        <meshStandardMaterial color="#C4A882" roughness={0.2} metalness={0.6} />
      </mesh>
    </group>
  );
}

function Envelope({ sent }: { sent: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    if (sent) {
      // Float toward the slot
      targetPos.set(0, 0.7, 0.5);
      meshRef.current.position.lerp(targetPos, 0.05);
      meshRef.current.rotation.x += 0.02;
      meshRef.current.rotation.z += 0.01;
    } else {
      // Idle floating
      meshRef.current.position.y = 1.5 + Math.sin(t * 1.5) * 0.1;
      meshRef.current.position.x = Math.sin(t * 0.8) * 0.2;
      meshRef.current.rotation.z = Math.sin(t * 0.5) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 1.5, 0.5]}>
      <boxGeometry args={[0.4, 0.02, 0.28]} />
      <meshStandardMaterial color="#F5ECD7" roughness={0.8} />
    </mesh>
  );
}

function Ground() {
  return (
    <mesh position={[0, -1.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[10, 10]} />
      <meshStandardMaterial color="#2a1f1a" roughness={0.9} />
    </mesh>
  );
}

export function PostboxScene({ onPosted }: { onPosted?: () => void }) {
  const [sent, setSent] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSend = () => {
    setSent(true);
    setTimeout(() => {
      setShaking(true);
      setTimeout(() => {
        setShaking(false);
        onPosted?.();
      }, 600);
    }, 1500);
  };

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [2, 1, 4], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.2} color="#ffcc88" />
        <pointLight position={[3, 4, 3]} intensity={0.6} color="#ff9966" />
        <pointLight position={[-2, 2, -1]} intensity={0.3} color="#ff6644" />
        <spotLight
          position={[0, 5, 2]}
          angle={0.3}
          penumbra={0.5}
          intensity={0.8}
          color="#ffcc88"
        />

        <Postbox shaking={shaking} />
        <Envelope sent={sent} />
        <Ground />

        <OrbitControls
          enablePan={false}
          minDistance={3}
          maxDistance={8}
          target={[0, 0, 0]}
        />
      </Canvas>

      {/* Send button overlay */}
      {!sent && (
        <button
          onClick={handleSend}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 px-xl py-md bg-wax-red text-surface-bright font-label-md text-label-md uppercase tracking-widest rounded-sm hover:bg-wax-red-dark transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg z-10"
        >
          Send Letter
        </button>
      )}
      {sent && !shaking && (
        <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-caption text-caption text-on-surface-variant animate-fade-in">
          Sliding into the postbox...
        </p>
      )}
      {shaking && (
        <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-caption text-caption text-wax-red animate-fade-in">
          Posted!
        </p>
      )}
    </div>
  );
}
