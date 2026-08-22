import type { SolarPanelArray, Vec2 } from "./project-model";
import type { RoofSurfaceFrame } from "./roof-surface-geometry";

export function getSolarPanelModuleSize(array: SolarPanelArray) {
  return array.orientation === "Portrait"
    ? { widthM: array.panelWidthM, heightM: array.panelHeightM }
    : { widthM: array.panelHeightM, heightM: array.panelWidthM };
}

export function getSolarPanelArraySize(array: SolarPanelArray) {
  const moduleSize = getSolarPanelModuleSize(array);
  return {
    widthM:
      array.columns * moduleSize.widthM + Math.max(0, array.columns - 1) * array.gapM,
    heightM:
      array.rows * moduleSize.heightM + Math.max(0, array.rows - 1) * array.gapM,
  };
}

export function getSolarPanelModuleOffsets(array: SolarPanelArray): Vec2[] {
  const moduleSize = getSolarPanelModuleSize(array);
  const arraySize = getSolarPanelArraySize(array);
  const stepU = moduleSize.widthM + array.gapM;
  const stepV = moduleSize.heightM + array.gapM;
  const offsets: Vec2[] = [];

  for (let row = 0; row < array.rows; row += 1) {
    for (let column = 0; column < array.columns; column += 1) {
      offsets.push({
        x: -arraySize.widthM / 2 + moduleSize.widthM / 2 + column * stepU,
        y: -arraySize.heightM / 2 + moduleSize.heightM / 2 + row * stepV,
      });
    }
  }

  return offsets;
}

export function getSolarPanelRectPlanCorners(
  frame: RoofSurfaceFrame,
  center: Vec2,
  widthM: number,
  heightM: number,
  offset: Vec2 = { x: 0, y: 0 },
) {
  const centerUv = frame.toUv(center);
  const halfWidth = widthM / 2;
  const halfHeight = heightM / 2;
  return [
    frame.uvToPlan({ x: centerUv.x + offset.x - halfWidth, y: centerUv.y + offset.y - halfHeight }),
    frame.uvToPlan({ x: centerUv.x + offset.x + halfWidth, y: centerUv.y + offset.y - halfHeight }),
    frame.uvToPlan({ x: centerUv.x + offset.x + halfWidth, y: centerUv.y + offset.y + halfHeight }),
    frame.uvToPlan({ x: centerUv.x + offset.x - halfWidth, y: centerUv.y + offset.y + halfHeight }),
  ];
}
