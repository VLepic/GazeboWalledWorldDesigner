import {
  DEFAULT_ROOF_LAYER_ID,
  DEFAULT_ROOF_LAYER_NAME,
  Project,
  createExternalModel,
  createLevel,
  createNodeData,
  createPose2D,
  createRoofLayer,
  createShape,
  createSlab,
  createVec2,
  createWall,
  createWallType,
} from "./project-model";

const groundLevel = createLevel({
  id: "level_ground",
  name: "Ground Floor",
  elevationM: 0,
});

const mezzanineLevel = createLevel({
  id: "level_mezzanine",
  name: "Mezzanine",
  elevationM: 3.2,
});

const structuralWall = createWallType({
  id: "wall_type_structural",
  name: "Structural Wall",
  thicknessM: 0.24,
  heightM: 3,
});

const partitionWall = createWallType({
  id: "wall_type_partition",
  name: "Partition",
  thicknessM: 0.12,
  heightM: 2.8,
});

const roofLayer = createRoofLayer({
  id: DEFAULT_ROOF_LAYER_ID,
  name: DEFAULT_ROOF_LAYER_NAME,
});

const nodeA = createNodeData({
  id: "node_a",
  levelId: groundLevel.id,
  position: createVec2(-4, -3),
});

const nodeB = createNodeData({
  id: "node_b",
  levelId: groundLevel.id,
  position: createVec2(4, -3),
});

const nodeC = createNodeData({
  id: "node_c",
  levelId: groundLevel.id,
  position: createVec2(4, 3),
});

const nodeD = createNodeData({
  id: "node_d",
  levelId: groundLevel.id,
  position: createVec2(-4, 3),
});

export const sampleProject: Project = {
  projectName: "WaWoD Studio",
  settings: {
    gridSpacingM: 0.5,
    nodeRadiusPx: 14,
    lineWidthPx: 7,
    gridLineWidthPx: 1,
    axisLineWidthPx: 2,
    pixelsPerMeter: 140,
    snapToGrid: true,
  },
  levels: [groundLevel, mezzanineLevel],
  wallTypes: [structuralWall, partitionWall],
  roofLayers: [roofLayer],
  roofSketches: [],
  roofOpenings: [],
  nodes: [nodeA, nodeB, nodeC, nodeD],
  walls: [
    createWall({
      id: "wall_ab",
      levelId: groundLevel.id,
      wallTypeId: structuralWall.id,
      startNodeId: nodeA.id,
      endNodeId: nodeB.id,
    }),
    createWall({
      id: "wall_bc",
      levelId: groundLevel.id,
      wallTypeId: structuralWall.id,
      startNodeId: nodeB.id,
      endNodeId: nodeC.id,
    }),
    createWall({
      id: "wall_cd",
      levelId: groundLevel.id,
      wallTypeId: structuralWall.id,
      startNodeId: nodeC.id,
      endNodeId: nodeD.id,
    }),
    createWall({
      id: "wall_da",
      levelId: groundLevel.id,
      wallTypeId: structuralWall.id,
      startNodeId: nodeD.id,
      endNodeId: nodeA.id,
    }),
  ],
  doors: [],
  windows: [],
  stairs: [],
  shapes: [
    createShape({
      id: "shape_column_1",
      levelId: groundLevel.id,
      name: "column_1",
      kind: "Cylinder",
      pose: createPose2D(createVec2(0, 0), 0),
      sizeM: 0.22,
      zStartM: 0,
      heightM: 3,
    }),
  ],
  slabs: [
    createSlab({
      id: "slab_ground",
      levelId: groundLevel.id,
      name: "ground_slab",
      kind: "Rectangle",
      pose: createPose2D(createVec2(0, 0), 0),
      widthM: 9,
      depthM: 7,
      thicknessM: 0.25,
      zOffsetM: 0,
    }),
  ],
  externalModels: [
    createExternalModel({
      id: "model_robot",
      levelId: mezzanineLevel.id,
      name: "ergocub_marker",
      uri: "model://ergoCubGazeboV1_3",
      position: createVec2(1.25, -0.5),
      zM: 0.5,
      yawRad: 0.4,
    }),
  ],
  measurements: [],
};
