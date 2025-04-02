from PyQt6.QtWidgets import QGraphicsPolygonItem, QGraphicsItem, QGraphicsSimpleTextItem, QGraphicsEllipseItem, QGraphicsRectItem
from PyQt6.QtGui import QBrush, QPen, QPolygonF
from PyQt6.QtCore import QPointF, Qt
import math


class RotateHandle(QGraphicsEllipseItem):
    def __init__(self, parent):
        super().__init__(-6, -6, 12, 12, parent)
        self.setBrush(QBrush(Qt.GlobalColor.red))
        self.setCursor(Qt.CursorShape.OpenHandCursor)
        self.setZValue(3)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable)
        self.parent = parent

    def mousePressEvent(self, event):
        self.center = self.parent.sceneBoundingRect().center()
        self.was_movable = self.parent.flags() & QGraphicsItem.GraphicsItemFlag.ItemIsMovable
        self.parent.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, False)
        self.parent.resize_handle.setOpacity(0)
        self.parent.rotate_handle.setOpacity(0)
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        pos = self.mapToScene(event.pos())
        dx = pos.x() - self.center.x()
        dy = pos.y() - self.center.y()
        angle = math.degrees(math.atan2(dy, dx))
        original_pos = self.parent.pos()
        self.parent.setRotation(angle)
        self.parent.setPos(original_pos)
        self.parent.update_handles()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.parent.update_handles()
        if self.was_movable:
            self.parent.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.parent.resize_handle.setOpacity(1.0)
        self.parent.rotate_handle.setOpacity(1.0)
        super().mouseReleaseEvent(event)


class ResizeHandle(QGraphicsRectItem):
    def __init__(self, parent, position):
        super().__init__(-5, -5, 10, 10, parent)
        self.setBrush(QBrush(Qt.GlobalColor.yellow))
        self.setCursor(Qt.CursorShape.SizeFDiagCursor)
        self.setZValue(3)
        self.position = position
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable)
        self.parent = parent

    def mousePressEvent(self, event):
        self.center = self.parent.sceneBoundingRect().center()
        self.was_movable = self.parent.flags() & QGraphicsItem.GraphicsItemFlag.ItemIsMovable
        self.parent.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, False)
        self.parent.resize_handle.setOpacity(0)
        self.parent.rotate_handle.setOpacity(0)

        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        pos = self.mapToScene(event.pos())
        center = self.parent.sceneBoundingRect().center()
        dx = pos.x() - center.x()
        dy = pos.y() - center.y()
        size = max(0.1, math.hypot(dx, dy))
        original_pos = self.parent.pos()
        self.parent.update_shape_size(size)
        self.parent.setPos(original_pos)
        self.parent.update_handles()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.parent.update_handles()
        if self.was_movable:
            self.parent.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.parent.resize_handle.setOpacity(1.0)
        self.parent.rotate_handle.setOpacity(1.0)
        super().mouseReleaseEvent(event)


class ShapeItem(QGraphicsPolygonItem):
    def __init__(self, shape_type, name, height, z_start, size=1.0):
        super().__init__()
        self.shape_type = shape_type
        self.name = name
        self.z_start = z_start
        self.z_end = z_start + height
        self.size = size

        self.setPolygon(self.create_polygon(shape_type, size))
        self.setBrush(QBrush(Qt.GlobalColor.darkBlue, Qt.BrushStyle.Dense6Pattern))
        self.setPen(QPen(Qt.GlobalColor.red, 2, Qt.PenStyle.DashLine))
        self.setZValue(1)

        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable |
            QGraphicsItem.GraphicsItemFlag.ItemIsSelectable |
            QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )

        self.label = QGraphicsSimpleTextItem(f"{name}\n{z_start:.2f}–{self.z_end:.2f} m")
        self.label.setBrush(QBrush(Qt.GlobalColor.white))
        self.label.setParentItem(self)
        self.label.setPos(10, -10)
        self.label.setZValue(2)

        self.resize_handle = ResizeHandle(self, "bottom-right")
        self.rotate_handle = RotateHandle(self)

        self.resize_handle.setVisible(False)
        self.rotate_handle.setVisible(False)
        self.update_handles()

    def update_shape_size(self, new_size):
        self.size = new_size
        self.setPolygon(self.create_polygon(self.shape_type, self.size))
        self.update_handles()

    def update_handles(self):
        r = self.size

        angle_resize = math.radians(45)
        rx = r * math.cos(angle_resize)
        ry = r * math.sin(angle_resize)
        self.resize_handle.setPos(QPointF(rx, ry))

        angle_rotate = math.radians(-90)
        dist_rotate = r + 20
        x_rot = dist_rotate * math.cos(angle_rotate)
        y_rot = dist_rotate * math.sin(angle_rotate)
        self.rotate_handle.setPos(QPointF(x_rot, y_rot))

    def create_polygon(self, shape, size):
        points = []

        if shape == "Square":
            sides = 4
        elif shape == "Cylinder":
            sides = 20
        else:
            return QPolygonF()  # Unsupported shape

        for i in range(sides):
            angle = 2 * math.pi * i / sides
            x = size * math.cos(angle)
            y = size * math.sin(angle)
            points.append(QPointF(x, y))

        return QPolygonF(points)

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemSelectedHasChanged:
            self.resize_handle.setVisible(self.isSelected())
            self.rotate_handle.setVisible(self.isSelected())
        if change == QGraphicsItem.GraphicsItemChange.ItemRotationHasChanged:
            self.label.setRotation(-self.rotation())

        return super().itemChange(change, value)

