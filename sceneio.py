import json
from node import Node, Line
from shapeitem import ShapeItem

def export_scene(view, filepath):
    data = {
        "nodes": [],
        "connections": [],
        "shapes": [],
        "external_models": view.external_models,
        "settings": {
            "wall_thickness": view.wall_thickness,
            "wall_height": view.wall_height,
            "grid_spacing": view.grid_spacing_m,
            "node_radius": view.radius,
            "line_width": view.line_width,
            "grid_line_width": view.grid_line_width,
            "axis_line_width": view.axis_line_width

        }
    }

    node_list = []
    node_map = {}

    for item in view.scene().items():
        if isinstance(item, Node):
            pos = item.pos()
            pos_m = [pos.x() / view.pixels_per_meter, pos.y() / view.pixels_per_meter]
            node_map[item] = len(node_list)
            node_list.append(pos_m)

    data["nodes"] = node_list

    for item in view.scene().items():
        if isinstance(item, ShapeItem):
            pos = item.scenePos()
            shape_data = {
                "type": item.shape_type,
                "name": item.name,
                "size": item.size,
                "x": pos.x() / view.pixels_per_meter,
                "y": pos.y() / view.pixels_per_meter,
                "rotation_deg": item.rotation(),
                "z_start": item.z_start,
                "z_end": item.z_end,
            }
            data["shapes"].append(shape_data)

    for item in node_map:
        for other, _ in item.connections:
            if item in node_map and other in node_map:
                i1, i2 = node_map[item], node_map[other]
                if [i2, i1] not in data["connections"]:
                    data["connections"].append([i1, i2])

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)


def import_scene(view, filepath):
    with open(filepath, "r") as f:
        data = json.load(f)

    view.scene().clear()
    view.draw_background()

    view.wall_thickness = data["settings"].get("wall_thickness", 0.05)
    view.wall_height = data["settings"].get("wall_height", 1.0)
    view.grid_spacing_m = data["settings"].get("grid_spacing", 0.5)
    view.radius = data["settings"].get("node_radius", 5)
    view.line_width = data["settings"].get("line_width", 2)
    view.external_models = data.get("external_models", [])
    view.grid_line_width = data["settings"].get("grid_line_width", view.grid_line_width)
    view.axis_line_width = data["settings"].get("axis_line_width", view.axis_line_width)

    node_objs = []

    for shape in data.get("shapes", []):
        item = ShapeItem(
            shape["type"],
            shape["name"],
            height=shape["z_end"] - shape["z_start"],
            z_start=shape["z_start"],
            size=shape["size"]
        )
        x = shape["x"] * view.pixels_per_meter
        y = shape["y"] * view.pixels_per_meter
        item.setPos(x, y)
        item.setRotation(shape["rotation_deg"])
        view.scene().addItem(item)

    for x_m, y_m in data["nodes"]:
        x = x_m * view.pixels_per_meter
        y = y_m * view.pixels_per_meter
        node = Node(x, y, view.radius)
        view.scene().addItem(node)
        node_objs.append(node)

    for i1, i2 in data["connections"]:
        n1, n2 = node_objs[i1], node_objs[i2]
        line = Line(n1, n2, view.line_width)
        view.scene().addItem(line)
        n1.connections.append((n2, line))
        n2.connections.append((n1, line))

    view.render_external_models()


import math

def export_world(view, filepath):
    lines = []
    node_map = {}
    nodes = []
    for item in view.scene().items():
        if isinstance(item, Node):
            pos = item.pos()
            pos_m = [pos.x() / view.pixels_per_meter, pos.y() / view.pixels_per_meter]
            node_map[item] = len(nodes)
            nodes.append(pos_m)

    used_connections = set()
    wall_thickness = view.wall_thickness
    wall_height = view.wall_height

    wall_models = []
    wall_id = 0

    for item in node_map:
        for other, _ in item.connections:
            pair = tuple(sorted((item, other), key=id))
            if pair in used_connections:
                continue
            used_connections.add(pair)

            x1, y1 = item.pos().x() / view.pixels_per_meter, item.pos().y() / view.pixels_per_meter
            x2, y2 = other.pos().x() / view.pixels_per_meter, other.pos().y() / view.pixels_per_meter

            dx = x2 - x1
            dy = y2 - y1
            length = (dx ** 2 + dy ** 2) ** 0.5
            angle = math.atan2(dy, dx)

            mid_x = (x1 + x2) / 2
            mid_y = (y1 + y2) / 2

            model = f"""
              <model name="wall_{wall_id}">
                <static>true</static>
                <link name="link">
                  <pose>{mid_x:.3f} {mid_y:.3f} {wall_height/2:.3f} 0 0 {angle:.3f}</pose>
                  <collision name="collision">
                    <geometry>
                      <box><size>{length:.3f} {wall_thickness:.3f} {wall_height:.3f}</size></box>
                    </geometry>
                  </collision>
                  <visual name="visual">
                    <geometry>
                      <box><size>{length:.3f} {wall_thickness:.3f} {wall_height:.3f}</size></box>
                    </geometry>
                  </visual>
                </link>
              </model>
            """
            wall_models.append(model)
            wall_id += 1

            # Válce v uzlech
            used_nodes = set()
            for n1, n2 in used_connections:
                used_nodes.add(n1)
                used_nodes.add(n2)

            cylinder_models = []
            cylinder_radius = wall_thickness / 2

            for i, node in enumerate(used_nodes):
                x = node.pos().x() / view.pixels_per_meter
                y = node.pos().y() / view.pixels_per_meter

                model = f"""
              <model name="corner_{i}">
                <static>true</static>
                <link name="link">
                  <pose>{x:.3f} {y:.3f} {wall_height / 2:.3f} 0 0 0</pose>
                  <collision name="collision">
                    <geometry>
                      <cylinder>
                        <radius>{cylinder_radius:.3f}</radius>
                        <length>{wall_height:.3f}</length>
                      </cylinder>
                    </geometry>
                  </collision>
                  <visual name="visual">
                    <geometry>
                      <cylinder>
                        <radius>{cylinder_radius:.3f}</radius>
                        <length>{wall_height:.3f}</length>
                      </cylinder>
                    </geometry>
                  </visual>
                </link>
              </model>
            """
                cylinder_models.append(model)

    extras = """
              <include>
                <uri>model://ground_plane</uri>
              </include>
              <include>
                <uri>model://sun</uri>
              </include>
            """

    model_includes = ""

    for item in view.scene().items():
        if isinstance(item, ShapeItem):
            pos = item.scenePos()
            x = pos.x() / view.pixels_per_meter
            y = pos.y() / view.pixels_per_meter
            z = (item.z_start + item.z_end) / 2
            height = item.z_end - item.z_start
            yaw = math.radians(item.rotation())
            size = item.size / view.pixels_per_meter

            if item.shape_type == "Cylinder":
                model = f"""
                  <model name="{item.name}">
                    <static>true</static>
                    <link name="link">
                      <pose>{x:.3f} {y:.3f} {z:.3f} 0 0 {yaw:.3f}</pose>
                      <collision name="collision">
                        <geometry>
                          <cylinder>
                            <radius>{size:.3f}</radius>
                            <length>{height:.3f}</length>
                          </cylinder>
                        </geometry>
                      </collision>
                      <visual name="visual">
                        <geometry>
                          <cylinder>
                            <radius>{size:.3f}</radius>
                            <length>{height:.3f}</length>
                          </cylinder>
                        </geometry>
                      </visual>
                    </link>
                  </model>
                """
                model_includes += model

            elif item.shape_type == "Square":
                model = f"""
                  <model name="{item.name}">
                    <static>true</static>
                    <link name="link">
                      <pose>{x:.3f} {y:.3f} {z:.3f} 0 0 {yaw:.3f}</pose>
                      <collision name="collision">
                        <geometry>
                          <box>
                            <size>{2 * size:.3f} {2 * size:.3f} {height:.3f}</size>
                          </box>
                        </geometry>
                      </collision>
                      <visual name="visual">
                        <geometry>
                          <box>
                            <size>{2 * size:.3f} {2 * size:.3f} {height:.3f}</size>
                          </box>
                        </geometry>
                      </visual>
                    </link>
                  </model>
                """
                model_includes += model

    for model in view.external_models:
        x, y, z, r, p, yaw = model["pose"]
        model_includes += f"""
          <include>
            <uri>{model['uri']}</uri>
            <name>{model['name']}</name>
            <pose>{x} {y} {z} {r} {p} {yaw}</pose>
          </include>
        """

    world = f"""<?xml version="1.0" ?>
            <sdf version="1.6">
              <world name="default">
            {''.join(wall_models)}
            {''.join(cylinder_models)}
            {''.join(model_includes)}
            {extras}
              </world>
            </sdf>
            """

    with open(filepath, "w") as f:
        f.write(world)
