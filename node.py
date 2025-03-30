from PyQt6.QtWidgets import QGraphicsItem, QGraphicsLineItem
from PyQt6.QtGui import QBrush, QPen
from PyQt6.QtCore import QPointF, Qt
from PyQt6.QtWidgets import QGraphicsEllipseItem


class Node(QGraphicsEllipseItem):
    def __init__(self, x, y, radius=5):
        super().__init__(-radius, -radius, radius * 2, radius * 2)
        self.setBrush(QBrush(Qt.GlobalColor.red))
        self.setPen(QPen(Qt.GlobalColor.black))
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsScenePositionChanges, True)
        self.setPos(x, y)
        self.connections = []  # list of (other_node, line)

    def remove_all_connections(self, scene):
        for other_node, line in self.connections:
            if line in scene.items():
                scene.removeItem(line)
            if (self, line) in other_node.connections:
                other_node.connections.remove((self, line))
        self.connections.clear()

    def itemChange(self, change, value):
        if self.scene() is None:
            return super().itemChange(change, value)

        view = self.scene().views()[0]

        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange:
            if hasattr(view, "snap_to_grid") and view.snap_to_grid:
                grid_size = view.grid_spacing_m * view.pixels_per_meter
                snapped_x = round(value.x() / grid_size) * grid_size
                snapped_y = round(value.y() / grid_size) * grid_size
                return QPointF(snapped_x, snapped_y)

        elif change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            for other_node, line in self.connections:
                if line.scene():
                    line.update_position()

        return super().itemChange(change, value)

    def highlight(self, active: bool):
        if active:
            self.setBrush(QBrush(Qt.GlobalColor.blue))
        else:
            self.setBrush(QBrush(Qt.GlobalColor.red))

class Line(QGraphicsLineItem):
    def __init__(self, node1, node2, width=2):
        super().__init__()
        self.node1 = node1
        self.node2 = node2
        self.setPen(QPen(Qt.GlobalColor.green, width))
        self.update_position()

    def update_position(self):
        p1 = self.node1.pos()
        p2 = self.node2.pos()
        self.setLine(p1.x(), p1.y(), p2.x(), p2.y())