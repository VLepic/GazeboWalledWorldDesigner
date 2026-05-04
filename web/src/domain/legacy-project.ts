export const legacyProjectExample = {
  nodes: [
    [-3, -2],
    [3, -2],
    [3, 2],
    [-3, 2],
  ],
  connections: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  shapes: [
    {
      type: "Cylinder",
      name: "legacy_column",
      size: 44,
      x: 0,
      y: 0,
      rotation_deg: 0,
      z_start: 0,
      z_end: 3,
    },
  ],
  external_models: [
    {
      name: "legacy_robot",
      uri: "model://ergoCubGazeboV1_3",
      pose: [1.25, -0.5, 0.5, 0, 0, 0.4],
    },
  ],
  settings: {
    wall_thickness: 0.24,
    wall_height: 3,
    grid_spacing: 0.5,
    node_radius: 14,
    line_width: 7,
    grid_line_width: 1,
    axis_line_width: 2,
    pixels_per_meter: 140,
  },
};
