import sys
from PyQt6.QtWidgets import (
    QMainWindow, QApplication, QGraphicsScene, QToolBar, QDoubleSpinBox, QLabel, QFileDialog
)
from PyQt6.QtGui import QAction
from PyQt6.QtCore import Qt
from nodeview import NodeView
from node import Node, Line
from sceneio import export_scene, import_scene, export_world


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Gazebo walled world designer")
        self.setGeometry(100, 100, 800, 600)
        self.status = self.statusBar()
        self.scene = QGraphicsScene()
        self.view = NodeView(self.scene, self.status)
        self.setCentralWidget(self.view)
        self.radius = 5
        self.line_width = 2

        self.init_toolbar()

    def init_toolbar(self):
        tool_toolbar = QToolBar("Tool Selection")
        self.addToolBar(Qt.ToolBarArea.TopToolBarArea, tool_toolbar)

        add_action = QAction("Node Creation Tool", self)
        add_action.triggered.connect(lambda: self.view.set_tool("create"))
        tool_toolbar.addAction(add_action)

        connect_action = QAction("Node Linking Tool", self)
        connect_action.triggered.connect(lambda: self.view.set_tool("connect"))
        tool_toolbar.addAction(connect_action)

        move_action = QAction("Move Tool", self)
        move_action.triggered.connect(lambda: self.view.set_tool("move"))
        tool_toolbar.addAction(move_action)

        add_model_action = QAction("Add Model", self)
        add_model_action.triggered.connect(lambda: self.view.set_tool("add_model"))
        tool_toolbar.addAction(add_model_action)

        # Nastavení zdi (vpravo)
        wall_toolbar = QToolBar("Wall Settings")
        self.addToolBar(Qt.ToolBarArea.RightToolBarArea, wall_toolbar)

        # Tloušťka zdi
        thickness_label = QLabel("Wall thickness (m):")
        wall_toolbar.addWidget(thickness_label)

        self.thickness_spin = QDoubleSpinBox()
        self.thickness_spin.setRange(0.01, 1.0)
        self.thickness_spin.setSingleStep(0.01)
        self.thickness_spin.setValue(self.view.wall_thickness)
        self.thickness_spin.setSuffix(" m")
        self.thickness_spin.valueChanged.connect(self.update_wall_thickness)
        wall_toolbar.addWidget(self.thickness_spin)

        # Výška zdi
        height_label = QLabel("Wall height (m):")
        wall_toolbar.addWidget(height_label)

        self.height_spin = QDoubleSpinBox()
        self.height_spin.setRange(0.1, 5.0)
        self.height_spin.setSingleStep(0.1)
        self.height_spin.setValue(self.view.wall_height)
        self.height_spin.setSuffix(" m")
        self.height_spin.valueChanged.connect(self.update_wall_height)
        wall_toolbar.addWidget(self.height_spin)

        # Mřížka - rozteč
        grid_label = QLabel("Grid spacing (m):")
        wall_toolbar.addWidget(grid_label)

        self.grid_spin = QDoubleSpinBox()
        self.grid_spin.setRange(0.05, 5.0)
        self.grid_spin.setSingleStep(0.05)
        self.grid_spin.setValue(self.view.grid_spacing_m)
        self.grid_spin.setSuffix(" m")
        self.grid_spin.valueChanged.connect(self.update_grid_spacing)
        wall_toolbar.addWidget(self.grid_spin)

        # Node size
        radius_label = QLabel("Node size (px):")
        wall_toolbar.addWidget(radius_label)

        self.radius_spin = QDoubleSpinBox()
        self.radius_spin.setRange(2, 20)
        self.radius_spin.setSingleStep(1)
        self.radius_spin.setValue(self.view.radius)
        self.radius_spin.setSuffix(" px")
        self.radius_spin.valueChanged.connect(self.update_node_radius)
        wall_toolbar.addWidget(self.radius_spin)

        # Line width
        line_label = QLabel("Line width (px):")
        wall_toolbar.addWidget(line_label)

        self.line_width_spin = QDoubleSpinBox()
        self.line_width_spin.setRange(1, 10)
        self.line_width_spin.setSingleStep(1)
        self.line_width_spin.setValue(self.view.line_width)
        self.line_width_spin.setSuffix(" px")
        self.line_width_spin.valueChanged.connect(self.update_line_width)
        wall_toolbar.addWidget(self.line_width_spin)

        save_action = QAction("Save to json", self)
        save_action.triggered.connect(self.save_scene)
        tool_toolbar.addAction(save_action)

        load_action = QAction("Load from json", self)
        load_action.triggered.connect(self.load_scene)
        tool_toolbar.addAction(load_action)

        export_action = QAction("Export .world", self)
        export_action.triggered.connect(self.export_world_file)
        tool_toolbar.addAction(export_action)

    def update_node_radius(self, value):
        self.view.radius = value
        for item in self.view.scene().items():
            if isinstance(item, Node):
                item.setRect(-value, -value, value * 2, value * 2)

    def update_line_width(self, value):
        self.view.line_width = value
        for item in self.view.scene().items():
            if isinstance(item, Line):
                pen = item.pen()
                pen.setWidthF(value)
                item.setPen(pen)

    def save_scene(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save Scene", "", "JSON Files (*.json)")
        if path:
            export_scene(self.view, path)

    def load_scene(self):
        path, _ = QFileDialog.getOpenFileName(self, "Load Scene", "", "JSON Files (*.json)")
        if path:
            import_scene(self.view, path)
            self.refresh_settings_controls()

    def export_world_file(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export to .world", "", "SDF World (*.world)")
        if path:
            export_world(self.view, path)

    def update_wall_thickness(self, value):
        self.view.wall_thickness = value
        self.view.preview_thickness_px = int(value * 200)

    def update_wall_height(self, value):
        self.view.wall_height = value

    def update_grid_spacing(self, value):
        self.view.grid_spacing_m = value
        self.view.draw_background()

    def refresh_settings_controls(self):
        self.grid_spin.setValue(self.view.grid_spacing_m)
        self.radius_spin.setValue(self.view.radius)
        self.line_width_spin.setValue(self.view.line_width)
        self.thickness_spin.setValue(self.view.wall_thickness)
        self.height_spin.setValue(self.view.wall_height)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())







