from PyQt5.QtCore import Qt, QPointF, QTimer
from PyQt5.QtWidgets import QGraphicsView, QGraphicsRectItem, QGraphicsEllipseItem, QGraphicsLineItem, QApplication, QGraphicsItem, QGraphicsSimpleTextItem
from PyQt5.QtGui import QPen, QPainter, QColor, QTransform, QBrush
import math
from modeldialog import ModelInsertDialog
from node import Node, Line

class ModelMarkerItem(QGraphicsEllipseItem):
    def __init__(self, index, view, *args):
        super().__init__(*args)
        self.model_index = index
        self.view = view

        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsScenePositionChanges, True)

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            x = value.x() / self.view.pixels_per_meter
            y = value.y() / self.view.pixels_per_meter
            self.view.external_models[self.model_index]["pose"][0] = x
            self.view.external_models[self.model_index]["pose"][1] = y
        return super().itemChange(change, value)


class NodeView(QGraphicsView):
    def __init__(self, scene, status_bar):
        super().__init__(scene)
        self.radius = 15
        self.tool = "create"
        self.first_node = None
        self.status_bar = status_bar
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setMouseTracking(True)
        self.snap_to_grid = True
        self.grid_spacing_m = 1.0  # rozteč mřížky v metrech
        self.pixels_per_meter = 200  # převod na pixely
        self.line_width = 7
        self._panning = False
        self._pan_start = QPointF()
        self.external_models = []
        self.model_markers = []

        self.wall_height = 2.0
        self.wall_thickness = 0.2
        self.preview_thickness_px = max(1, int(self.wall_thickness * self.pixels_per_meter))

        self.draw_background()

    def center_scene(self):
        width = self.viewport().width()
        height = self.viewport().height()
        half_w = width // 2
        half_h = height // 2

        self.setSceneRect(-half_w, -half_h, width, height)

    def resizeEvent(self, event):
        super().resizeEvent(event)

        for item in self.scene().items():
            if isinstance(item, QGraphicsLineItem) and item.zValue() == -100:
                self.scene().removeItem(item)

        self.draw_background()

    def set_tool(self, tool_name):
        self.tool = tool_name
        self.first_node = None

    def mousePressEvent(self, event):
        pos = self.mapToScene(event.pos())
        items = self.scene().items(pos)

        if event.button() == Qt.MiddleButton:
            self._panning = True
            self._pan_start = event.pos()
            self.setCursor(Qt.ClosedHandCursor)

        if self.tool == "create":
            if event.button() == Qt.LeftButton:
                x, y = pos.x(), pos.y()
                if self.snap_to_grid:
                    grid_size = self.grid_spacing_m * self.pixels_per_meter
                    x = round(x / grid_size) * grid_size
                    y = round(y / grid_size) * grid_size

                node = Node(x, y, self.radius)
                self.scene().addItem(node)
                self.ensure_node_visible(x, y)
            elif event.button() == Qt.RightButton:
                for item in items:
                    if isinstance(item, Node):
                        item.remove_all_connections(self.scene())
                        self.scene().removeItem(item)
                        break

        elif self.tool == "add_model":
            if event.button() == Qt.LeftButton:
                pos = self.mapToScene(event.pos())
                x = pos.x() / self.pixels_per_meter
                y = pos.y() / self.pixels_per_meter

                QTimer.singleShot(0, lambda: self.open_model_dialog(x, y))
            elif event.button() == Qt.RightButton:
                for item in self.scene().items(pos):
                    if hasattr(item, "model_index"):
                        index = item.model_index
                        self.scene().removeItem(item)
                        self.external_models.pop(index)
                        self.status_bar.showMessage("Model removed")
                        self.clear_and_redraw_models()
                        return




        elif self.tool == "connect":
            for item in items:
                if isinstance(item, Node):
                    if event.button() == Qt.LeftButton:
                        if self.first_node is None:
                            self.first_node = item
                            item.highlight(True)  # zvýraznění
                        elif self.first_node != item:
                            # Zkontroluj, zda už spojení neexistuje
                            exists = any(conn[0] == item for conn in self.first_node.connections)
                            if not exists:
                                line = Line(self.first_node, item, self.line_width)
                                self.scene().addItem(line)
                                self.first_node.connections.append((item, line))
                                item.connections.append((self.first_node, line))
                            self.first_node.highlight(False)
                            self.first_node = None

                    elif event.button() == Qt.RightButton:
                        item.remove_all_connections(self.scene())
                        if self.first_node == item:
                            item.highlight(False)
                            self.first_node = None
                    break
        else:
            super().mousePressEvent(event)

    def open_model_dialog(self, x, y):
        dialog = ModelInsertDialog(x, y, parent=self.window())
        if dialog.exec():
            model = dialog.result_data
            self.external_models.append(model)
            index = len(self.external_models) - 1  # index v seznamu

            if self.status_bar:
                self.status_bar.showMessage(
                    f"Model '{model['name']}' added at ({x:.2f}, {y:.2f})"
                )

            self.external_models.append(model)
            index = len(self.external_models) - 1

            self.add_external_model_marker(model, index)

    def ensure_node_visible(self, x, y, margin=100):
        rect = self.sceneRect()
        changed = False

        left = rect.left()
        right = rect.right()
        top = rect.top()
        bottom = rect.bottom()

        if x < left + margin:
            left = x - margin
            changed = True
        if x > right - margin:
            right = x + margin
            changed = True
        if y < top + margin:
            top = y - margin
            changed = True
        if y > bottom - margin:
            bottom = y + margin
            changed = True

        if changed:
            self.setSceneRect(left, top, right - left, bottom - top)

    def draw_background(self):
        for item in self.scene().items():
            if isinstance(item, QGraphicsLineItem) and item.zValue() == -100:
                self.scene().removeItem(item)
        grid_color = QColor(Qt.lightGray)
        grid_color.setAlpha(80)
        pen_grid = QPen(grid_color)
        pen_grid.setWidth(1)
        pen_grid.setStyle(Qt.DotLine)


        pen_axis = QPen(Qt.gray)
        pen_axis.setStyle(Qt.DashLine)
        pen_axis.setWidth(2)

        grid_size = int(self.grid_spacing_m * self.pixels_per_meter)

        # velikost zobrazeného okna
        visible_rect = self.mapToScene(self.viewport().rect()).boundingRect()

        left = int(visible_rect.left()) - (int(visible_rect.left()) % grid_size)
        right = int(visible_rect.right())
        top = int(visible_rect.top()) - (int(visible_rect.top()) % grid_size)
        bottom = int(visible_rect.bottom())
        # Mřížka
        for x in range(left, right, grid_size):
            line = self.scene().addLine(x, top, x, bottom, pen_grid)
            line.setZValue(-100)

        for y in range(top, bottom, grid_size):
            line = self.scene().addLine(left, y, right, y, pen_grid)
            line.setZValue(-100)

        # Osy
        axis_x = self.scene().addLine(left, 0, right, 0, pen_axis)
        axis_x.setZValue(-100)

        axis_y = self.scene().addLine(0, top, 0, bottom, pen_axis)
        axis_y.setZValue(-100)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            if self.first_node:
                self.first_node.highlight(False)
                self.first_node = None


        elif event.key() == Qt.Key_E:
            connections = []
            for item in self.scene().items():
                if isinstance(item, Node):
                    for other_node, _ in item.connections:
                        if id(item) < id(other_node):  # unifikované spojení
                            connections.append((
                                (item.pos().x(), item.pos().y()),
                                (other_node.pos().x(), other_node.pos().y())
                            ))

            self.draw_preview_walls(connections)
            self.status_bar.showMessage(f"{len(connections)} wall(s) displayed (preview)")


        elif event.key() == Qt.Key_G:
            self.snap_to_grid = not self.snap_to_grid
            state = "ON" if self.snap_to_grid else "OFF"
            self.status_bar.showMessage(f"Snap to Grid: {state}")


        elif event.key() == Qt.Key_R:
            count = 0
            for item in self.scene().items():
                if (
                        isinstance(item, QGraphicsRectItem) or
                        isinstance(item, QGraphicsEllipseItem)
                ) and item.zValue() == 1:
                    self.scene().removeItem(item)
                    count += 1
            self.status_bar.showMessage(f"{count} preview wall(s) and corner(s) removed")

    def mouseMoveEvent(self, event):
        pos = self.mapToScene(event.pos())
        pos_m = QPointF(pos.x() / self.pixels_per_meter, pos.y() / self.pixels_per_meter)

        message = f"Mouse: ({pos_m.x():.2f} m, {pos_m.y():.2f} m)"

        for item in self.scene().items(pos):
            if isinstance(item, Node):
                node_pos = item.pos()
                node_m = QPointF(node_pos.x() / self.pixels_per_meter, node_pos.y() / self.pixels_per_meter)
                message += f" | Node: ({node_m.x():.2f} m, {node_m.y():.2f} m)"
                break

        if self._panning:
            delta = event.pos() - self._pan_start
            self._pan_start = event.pos()
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - delta.x())
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - delta.y())

        self.status_bar.showMessage(message)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MiddleButton:
            self._panning = False
            self.setCursor(Qt.ArrowCursor)
        else:
            super().mouseReleaseEvent(event)

    def wheelEvent(self, event):
        zoom_in_factor = 1.15
        zoom_out_factor = 1 / zoom_in_factor

        if event.angleDelta().y() > 0:
            zoom_factor = zoom_in_factor
        else:
            zoom_factor = zoom_out_factor

        # Zoom na pozici kurzoru
        old_pos = self.mapToScene(event.position().toPoint())
        self.scale(zoom_factor, zoom_factor)
        new_pos = self.mapToScene(event.position().toPoint())

        delta = new_pos - old_pos
        self.translate(delta.x(), delta.y())

    def draw_preview_walls(self, connections):
        # Smazat předchozí náhledy
        for item in self.scene().items():
            if isinstance(item, QGraphicsRectItem) and item.zValue() == 1:
                self.scene().removeItem(item)
            elif isinstance(item, QGraphicsEllipseItem) and item.zValue() == 1:
                self.scene().removeItem(item)

        used_nodes = set()
        radius = self.preview_thickness_px / 2

        for i, ((x1, y1), (x2, y2)) in enumerate(connections):
            dx = x2 - x1
            dy = y2 - y1
            length = (dx ** 2 + dy ** 2) ** 0.5
            mid_x = (x1 + x2) / 2
            mid_y = (y1 + y2) / 2
            angle_deg = math.degrees(math.atan2(dy, dx))

            # Zeď
            if length == 0:
                continue

            rect = QGraphicsRectItem(-length / 2, -radius, length, self.preview_thickness_px)
            rect.setBrush(QBrush(Qt.darkGray))
            rect.setPen(QPen(Qt.transparent))
            rect.setPos(mid_x, mid_y)
            rect.setRotation(angle_deg)
            rect.setZValue(1)
            self.scene().addItem(rect)

            used_nodes.add((round(x1, 2), round(y1, 2)))
            used_nodes.add((round(x2, 2), round(y2, 2)))


        for x, y in used_nodes:
            circle = QGraphicsEllipseItem(-radius, -radius, 2 * radius, 2 * radius)
            circle.setBrush(QBrush(Qt.gray))
            circle.setPen(QPen(Qt.transparent))
            circle.setPos(x, y)
            circle.setZValue(1)  # nejvyšší vrstva
            self.scene().addItem(circle)

    def render_external_models(self):
        for i, model in enumerate(self.external_models):
            self.add_external_model_marker(model, i)

    def clear_and_redraw_models(self):
        for marker in self.model_markers:
            self.scene().removeItem(marker)
        self.model_markers.clear()
        self.render_external_models()

    def add_external_model_marker(self, model, index):
        x_px = model["pose"][0] * self.pixels_per_meter
        y_px = model["pose"][1] * self.pixels_per_meter

        marker = ModelMarkerItem(index, self, -10, -10, 20, 20)
        marker.setBrush(QBrush(Qt.blue))
        marker.setPen(QPen(Qt.black))
        marker.setZValue(2)
        marker.setPos(x_px, y_px)

        self.scene().addItem(marker)

        label = QGraphicsSimpleTextItem(model["name"])
        label.setBrush(QBrush(Qt.white))
        label.setZValue(2)
        label.setParentItem(marker)
        label.setPos(12, -12)

        if not hasattr(self, "model_markers"):
            self.model_markers = []
        self.model_markers.append(marker)







