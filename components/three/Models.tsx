'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * A stylized 3D envelope built from simple geometry.
 * Flap can open/close via the `flapOpen` prop (0 = closed, 1 = open).
 */
export function Envelope3D({
  flapOpen = 0,
  scale = 1,
  color = '#FBF7F0',
  waxColor = '#C0392B',
}: {
  flapOpen?: number;
  scale?: number;
  color?: string;
  waxColor?: string;
}) {
  const flapRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (flapRef.current) {
      const target = -Math.PI * 0.5 * (1 - flapOpen);
      flapRef.current.rotation.x = THREE.MathUtils.lerp(
        flapRef.current.rotation.x,
        target,
        0.1,
      );
    }
  });

  return (
    <group scale={scale}>
      {/* Envelope body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.05, 1.6]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>

      {/* Back flap (fixed) */}
      <mesh position={[0, 0.01, -0.78]} rotation={[Math.PI * 0.35, 0, 0]} castShadow>
        <planeGeometry args={[2.4, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* Top flap (animated open/close) */}
      <group ref={flapRef} position={[0, 0.03, 0.8]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <planeGeometry args={[2.4, 0.9]} />
          <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Side flaps (fixed, folded inward) */}
      <mesh position={[-1.15, 0.015, 0]} rotation={[0, Math.PI * 0.42, 0]} castShadow>
        <planeGeometry args={[1.5, 1.4]} />
        <meshStandardMaterial color={'#F0EDE7'} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[1.15, 0.015, 0]} rotation={[0, -Math.PI * 0.42, 0]} castShadow>
        <planeGeometry args={[1.5, 1.4]} />
        <meshStandardMaterial color={'#F0EDE7'} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.015, 0]} castShadow>
        <planeGeometry args={[2.3, 1.5]} />
        <meshStandardMaterial color={'#ECE8E2'} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* Wax seal on the center */}
      {flapOpen < 0.5 && (
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.3, 0.08, 24]} />
          <meshStandardMaterial color={waxColor} roughness={0.4} metalness={0.1} />
        </mesh>
      )}
    </group>
  );
}

/**
 * A simple stylized 3D wax seal stamp — a cylinder with a handle.
 * Used in the wax-seal scene to press down onto the envelope.
 */
export function WaxStamp3D({ pressing = false }: { pressing?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      const targetY = pressing ? -1.2 : 0;
      groupRef.current.position.y = THREE.MathUtils.lerp(
        groupRef.current.position.y,
        targetY,
        0.06,
      );
    }
  });

  return (
    <group ref={groupRef}>
      {/* Handle */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 1.8, 12]} />
        <meshStandardMaterial color="#5A4A3A" roughness={0.6} />
      </mesh>
      {/* Handle knob */}
      <mesh position={[0, 2.15, 0]} castShadow>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color="#3A2A1A" roughness={0.5} />
      </mesh>
      {/* Stamp head */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.3, 24]} />
        <meshStandardMaterial color="#6B5B4B" roughness={0.5} />
      </mesh>
      {/* Stamp face (wax-contact side) */}
      <mesh position={[0, -0.02, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.45, 0.06, 24]} />
        <meshStandardMaterial color="#4A3A2A" roughness={0.7} />
      </mesh>
    </group>
  );
}

/**
 * A simple stylized 3D postbox (Victorian pillar box shape).
 */
export function Postbox3D({ shaking = false }: { shaking?: boolean }) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (ref.current) {
      if (shaking) {
        ref.current.position.x = Math.sin(state.clock.elapsedTime * 30) * 0.04;
        ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 28) * 0.02;
      } else {
        ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, 0, 0.1);
        ref.current.rotation.z = THREE.MathUtils.lerp(ref.current.rotation.z, 0, 0.1);
      }
    }
  });

  const red = useMemo(() => new THREE.Color('#C0392B'), []);

  return (
    <group ref={ref}>
      {/* Base pillar */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.6, 1.8, 24]} />
        <meshStandardMaterial color={red} roughness={0.5} metalness={0.15} />
      </mesh>
      {/* Top cap */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.62, 0.55, 0.3, 24]} />
        <meshStandardMaterial color={new THREE.Color('#962D22')} roughness={0.5} metalness={0.15} />
      </mesh>
      {/* Dome top */}
      <mesh position={[0, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.6, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={red} roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Finial */}
      <mesh position={[0, 1.95, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 0.2, 8]} />
        <meshStandardMaterial color="#3A2A1A" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Slot */}
      <mesh position={[0, 1.45, 0.58]} castShadow>
        <boxGeometry args={[0.35, 0.04, 0.02]} />
        <meshStandardMaterial color="#1a1410" roughness={0.9} />
      </mesh>
      {/* Door / collection plate */}
      <mesh position={[0, 0.5, 0.56]} castShadow>
        <boxGeometry args={[0.5, 0.7, 0.04]} />
        <meshStandardMaterial color={new THREE.Color('#962D22')} roughness={0.5} metalness={0.15} />
      </mesh>
      {/* "POST" plaque */}
      <mesh position={[0, 1.1, 0.57]} castShadow>
        <boxGeometry args={[0.3, 0.12, 0.03]} />
        <meshStandardMaterial color="#E8A838" roughness={0.3} metalness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * A simple stylized 3D house / cottage for the delivery scene.
 */
export function House3D() {
  return (
    <group>
      {/* Walls */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 1.4, 1.6]} />
        <meshStandardMaterial color="#F5EDE0" roughness={0.8} />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 1.0, 0]} rotation={[0, Math.PI * 0.25, 0]} castShadow>
        <coneGeometry args={[1.55, 0.9, 4]} />
        <meshStandardMaterial color="#8B5E3C" roughness={0.7} />
      </mesh>
      {/* Door */}
      <mesh position={[0, -0.35, 0.81]} castShadow>
        <boxGeometry args={[0.45, 0.7, 0.04]} />
        <meshStandardMaterial color="#6B4226" roughness={0.6} />
      </mesh>
      {/* Windows */}
      <mesh position={[-0.6, 0.15, 0.81]} castShadow>
        <boxGeometry args={[0.4, 0.4, 0.04]} />
        <meshStandardMaterial color="#A8D5E8" roughness={0.2} metalness={0.3} />
      </mesh>
      <mesh position={[0.6, 0.15, 0.81]} castShadow>
        <boxGeometry args={[0.4, 0.4, 0.04]} />
        <meshStandardMaterial color="#A8D5E8" roughness={0.2} metalness={0.3} />
      </mesh>
      {/* Mailbox out front */}
      <mesh position={[0, -0.8, 1.2]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.5, 12]} />
        <meshStandardMaterial color="#5A4A3A" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.5, 1.2]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.2]} />
        <meshStandardMaterial color="#C0392B" roughness={0.5} metalness={0.15} />
      </mesh>
    </group>
  );
}

/**
 * A simple stylized postman figure on a bicycle.
 * Low-poly, toy-like, charming.
 */
export function Postman3D({ progress = 0 }: { progress?: number }) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (ref.current) {
      ref.current.position.x = -4 + progress * 8;
      ref.current.position.y = -1.2 + Math.sin(state.clock.elapsedTime * 6) * 0.05;
      ref.current.rotation.y = Math.PI * 0.5;
    }
  });

  const wheelRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (wheelRef.current) {
      wheelRef.current.rotation.x = state.clock.elapsedTime * 8;
    }
  });

  return (
    <group ref={ref}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.4, 8, 12]} />
        <meshStandardMaterial color="#2D5F8B" roughness={0.6} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#F4D5B5" roughness={0.7} />
      </mesh>
      {/* Hat (postal cap) */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.08, 16]} />
        <meshStandardMaterial color="#1a3a5a" roughness={0.5} />
      </mesh>
      {/* Mail bag on back */}
      <mesh position={[0, 0.5, -0.25]} castShadow>
        <boxGeometry args={[0.3, 0.35, 0.15]} />
        <meshStandardMaterial color="#8B5E3C" roughness={0.7} />
      </mesh>

      {/* Bicycle frame (simplified) */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.05, 0.4, 0.05]} />
        <meshStandardMaterial color="#3A3A3A" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Wheels */}
      <mesh ref={wheelRef} position={[0, -0.2, 0.4]} castShadow>
        <torusGeometry args={[0.25, 0.03, 8, 20]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.2, -0.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.25, 0.03, 8, 20]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
    </group>
  );
}
