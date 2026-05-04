import { createVec2 } from "./project-model";
import type { Vec2 } from "./project-model";

export interface ViewportMetrics {
  widthPx: number;
  heightPx: number;
  pixelsPerMeter: number;
  zoom: number;
  pan: Vec2;
}

export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ViewportFrame {
  widthPx: number;
  heightPx: number;
}

function viewportScale(metrics: ViewportMetrics) {
  return Math.max(0.0001, metrics.pixelsPerMeter * metrics.zoom);
}

export function worldToScreen(point: Vec2, metrics: ViewportMetrics): Vec2 {
  const scale = viewportScale(metrics);

  return createVec2(
    metrics.widthPx / 2 + (point.x + metrics.pan.x) * scale,
    metrics.heightPx / 2 - (point.y + metrics.pan.y) * scale,
  );
}

export function screenToWorld(point: Vec2, metrics: ViewportMetrics): Vec2 {
  const scale = viewportScale(metrics);

  return createVec2(
    (point.x - metrics.widthPx / 2) / scale - metrics.pan.x,
    (metrics.heightPx / 2 - point.y) / scale - metrics.pan.y,
  );
}

export function getViewportBounds(metrics: ViewportMetrics): ViewportBounds {
  const topLeft = screenToWorld(createVec2(0, 0), metrics);
  const bottomRight = screenToWorld(
    createVec2(metrics.widthPx, metrics.heightPx),
    metrics,
  );

  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    maxX: Math.max(topLeft.x, bottomRight.x),
    minY: Math.min(bottomRight.y, topLeft.y),
    maxY: Math.max(bottomRight.y, topLeft.y),
  };
}

export function getZoomAroundPoint(
  nextZoom: number,
  cursorScreen: Vec2,
  metrics: ViewportMetrics,
): Vec2 {
  const previousWorld = screenToWorld(cursorScreen, metrics);
  const nextMetrics: ViewportMetrics = {
    ...metrics,
    zoom: nextZoom,
  };

  return createVec2(
    (cursorScreen.x - nextMetrics.widthPx / 2) / viewportScale(nextMetrics) - previousWorld.x,
    (nextMetrics.heightPx / 2 - cursorScreen.y) / viewportScale(nextMetrics) - previousWorld.y,
  );
}

export function getGridLines(bounds: ViewportBounds, spacingM: number) {
  const lines = {
    vertical: [] as number[],
    horizontal: [] as number[],
  };

  if (spacingM <= 0) {
    return lines;
  }

  const startX = Math.floor(bounds.minX / spacingM) * spacingM;
  const endX = Math.ceil(bounds.maxX / spacingM) * spacingM;
  for (let x = startX; x <= endX + spacingM * 0.5; x += spacingM) {
    lines.vertical.push(Number(x.toFixed(6)));
  }

  const startY = Math.floor(bounds.minY / spacingM) * spacingM;
  const endY = Math.ceil(bounds.maxY / spacingM) * spacingM;
  for (let y = startY; y <= endY + spacingM * 0.5; y += spacingM) {
    lines.horizontal.push(Number(y.toFixed(6)));
  }

  return lines;
}

export function snapValueToGrid(value: number, spacingM: number) {
  if (spacingM <= 0) {
    return value;
  }

  return Math.round(value / spacingM) * spacingM;
}

export function snapPointToGrid(point: Vec2, spacingM: number) {
  return createVec2(
    snapValueToGrid(point.x, spacingM),
    snapValueToGrid(point.y, spacingM),
  );
}

export function mergeViewportBounds(
  left: ViewportBounds | null,
  right: ViewportBounds | null,
) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minY: Math.min(left.minY, right.minY),
    maxY: Math.max(left.maxY, right.maxY),
  } satisfies ViewportBounds;
}

export function createViewportBoundsFromPoints(points: Vec2[]) {
  if (points.length === 0) {
    return null;
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  } satisfies ViewportBounds;
}

export function expandViewportBounds(bounds: ViewportBounds, marginM: number) {
  return {
    minX: bounds.minX - marginM,
    maxX: bounds.maxX + marginM,
    minY: bounds.minY - marginM,
    maxY: bounds.maxY + marginM,
  } satisfies ViewportBounds;
}

export function getViewportFit(
  bounds: ViewportBounds,
  frame: ViewportFrame,
  pixelsPerMeter: number,
  paddingPx = 72,
) {
  const contentWidthPx = Math.max(1, frame.widthPx - paddingPx * 2);
  const contentHeightPx = Math.max(1, frame.heightPx - paddingPx * 2);
  const widthM = Math.max(1, bounds.maxX - bounds.minX);
  const heightM = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.max(
    0.1,
    Math.min(
      contentWidthPx / (widthM * Math.max(1, pixelsPerMeter)),
      contentHeightPx / (heightM * Math.max(1, pixelsPerMeter)),
    ),
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    zoom,
    pan: createVec2(-centerX, -centerY),
  };
}
