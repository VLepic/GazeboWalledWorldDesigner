import polygonClipping from "polygon-clipping";
import { createVec2 } from "./project-model";
import type { Slab, Vec2 } from "./project-model";

const POINT_EPSILON = 0.000001;

function rotatePoint(point: Vec2, yawDeg: number) {
  const yawRad = (yawDeg * Math.PI) / 180;
  const cosine = Math.cos(yawRad);
  const sine = Math.sin(yawRad);
  return createVec2(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine,
  );
}

export function slabLocalToWorld(slab: Slab, point: Vec2) {
  const rotated = rotatePoint(point, slab.pose.yawDeg);
  return createVec2(
    slab.pose.position.x + rotated.x,
    slab.pose.position.y + rotated.y,
  );
}

export function slabWorldToLocal(slab: Slab, point: Vec2) {
  return rotatePoint(
    createVec2(
      point.x - slab.pose.position.x,
      point.y - slab.pose.position.y,
    ),
    -slab.pose.yawDeg,
  );
}

export function getSlabLocalPolygon(slab: Slab): Vec2[] {
  if (slab.kind === "Freeform") {
    return slab.polygon;
  }

  if (slab.kind === "Circle") {
    return [];
  }

  const halfWidthM = slab.widthM / 2;
  const halfDepthM = slab.depthM / 2;
  return [
    createVec2(-halfWidthM, -halfDepthM),
    createVec2(halfWidthM, -halfDepthM),
    createVec2(halfWidthM, halfDepthM),
    createVec2(-halfWidthM, halfDepthM),
  ];
}

export function getSlabWorldPolygon(slab: Slab) {
  return getSlabLocalPolygon(slab).map((point) => slabLocalToWorld(slab, point));
}

export function getPolygonCenter(points: readonly Vec2[]) {
  if (points.length === 0) {
    return createVec2();
  }

  const total = points.reduce(
    (sum, point) => createVec2(sum.x + point.x, sum.y + point.y),
    createVec2(),
  );
  return createVec2(total.x / points.length, total.y / points.length);
}

export function createLocalPolygonFromWorld(points: readonly Vec2[]) {
  const center = getPolygonCenter(points);
  return {
    center,
    polygon: points.map((point) =>
      createVec2(point.x - center.x, point.y - center.y),
    ),
  };
}

function toRing(points: readonly Vec2[]): [number, number][] {
  const ring = points.map((point) => [point.x, point.y] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    first &&
    last &&
    (Math.abs(first[0] - last[0]) > POINT_EPSILON ||
      Math.abs(first[1] - last[1]) > POINT_EPSILON)
  ) {
    ring.push([...first]);
  }
  return ring;
}

function fromRing(ring: readonly number[][]) {
  const points = ring.map((position) => createVec2(position[0], position[1]));
  if (
    points.length > 1 &&
    Math.abs(points[0].x - points[points.length - 1].x) <= POINT_EPSILON &&
    Math.abs(points[0].y - points[points.length - 1].y) <= POINT_EPSILON
  ) {
    points.pop();
  }
  return points;
}

export function unionConnectedPolygons(left: readonly Vec2[], right: readonly Vec2[]) {
  if (left.length < 3 || right.length < 3) {
    return null;
  }

  const result = polygonClipping.union([toRing(left)], [toRing(right)]);
  if (result.length !== 1 || result[0].length !== 1) {
    return null;
  }

  const polygon = fromRing(result[0][0]);
  return polygon.length >= 3 ? polygon : null;
}

export function getPolygonDimensions(points: readonly Vec2[]) {
  if (points.length === 0) {
    return { widthM: 0, depthM: 0 };
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  return {
    widthM: Math.max(...xValues) - Math.min(...xValues),
    depthM: Math.max(...yValues) - Math.min(...yValues),
  };
}
