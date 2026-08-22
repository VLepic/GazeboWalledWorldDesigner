import type { SolvedRoofFace } from "./roof-solver";
import type { Vec2 } from "./project-model";

export type Vec3Tuple = [number, number, number];

function add(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(value: Vec3Tuple, scalar: number): Vec3Tuple {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(left: Vec3Tuple, right: Vec3Tuple) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0.000001 ? scale(value, 1 / length) : [0, 0, 0];
}

export interface RoofSurfaceFrame {
  origin: Vec3Tuple;
  widthAxis: Vec3Tuple;
  heightAxis: Vec3Tuple;
  normal: Vec3Tuple;
  toWorld: (point: Vec2) => Vec3Tuple;
  toUv: (point: Vec2) => Vec2;
  fromUv: (point: Vec2) => Vec3Tuple;
  worldToPlan: (point: Vec3Tuple) => Vec2;
  uvToPlan: (point: Vec2) => Vec2;
}

export function createRoofSurfaceFrame(face: SolvedRoofFace): RoofSurfaceFrame {
  const originPlan = face.polygonLocal[0] ?? { x: 0, y: 0 };
  const toWorld = (point: Vec2): Vec3Tuple => [
    point.x,
    face.planeOuter.uCoeff * point.x +
      face.planeOuter.vCoeff * point.y +
      face.planeOuter.constantM,
    -point.y,
  ];
  const origin = toWorld(originPlan);
  const tangentX: Vec3Tuple = [1, face.planeOuter.uCoeff, 0];
  const tangentY: Vec3Tuple = [0, face.planeOuter.vCoeff, -1];
  const normal = normalize(cross(tangentX, tangentY));
  const gradientLength = Math.hypot(face.planeOuter.uCoeff, face.planeOuter.vCoeff);
  const widthAxis =
    gradientLength > 0.0001
      ? normalize([-face.planeOuter.vCoeff, 0, -face.planeOuter.uCoeff])
      : normalize(tangentX);
  const heightAxis = normalize(cross(normal, widthAxis));
  const fromUv = (point: Vec2) =>
    add(origin, add(scale(widthAxis, point.x), scale(heightAxis, point.y)));
  const worldToPlan = (point: Vec3Tuple): Vec2 => ({ x: point[0], y: -point[2] });

  return {
    origin,
    widthAxis,
    heightAxis,
    normal,
    toWorld,
    toUv: (point) => {
      const delta = subtract(toWorld(point), origin);
      return { x: dot(delta, widthAxis), y: dot(delta, heightAxis) };
    },
    fromUv,
    worldToPlan,
    uvToPlan: (point) => worldToPlan(fromUv(point)),
  };
}
