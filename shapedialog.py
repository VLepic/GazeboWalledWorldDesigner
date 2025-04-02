from PyQt6.QtWidgets import (
    QDialog, QLabel, QLineEdit, QDoubleSpinBox, QComboBox,
    QFormLayout, QVBoxLayout, QDialogButtonBox
)
from PyQt6.QtCore import Qt


class ShapeInsertDialog(QDialog):
    def __init__(self, x, y, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add Shape")
        self.setMinimumWidth(300)

        self.x = x
        self.y = y

        layout = QVBoxLayout()
        form = QFormLayout()

        self.name_input = QLineEdit("custom_shape")
        form.addRow("Object name:", self.name_input)

        self.shape_combo = QComboBox()
        self.shape_combo.addItems(["Cylinder", "Square"])
        form.addRow("Shape type:", self.shape_combo)

        self.height_input = QDoubleSpinBox()
        self.height_input.setRange(0.01, 10.0)
        self.height_input.setSingleStep(0.1)
        self.height_input.setValue(2.0)
        form.addRow("Shape height (m):", self.height_input)

        self.z_input = QDoubleSpinBox()
        self.z_input.setRange(0.0, 100.0)
        self.z_input.setSingleStep(0.1)
        self.z_input.setValue(0.0)
        form.addRow("Z (height start):", self.z_input)

        self.yaw_input = QDoubleSpinBox()
        self.yaw_input.setRange(-360.0, 360.0)
        self.yaw_input.setSingleStep(1.0)
        self.yaw_input.setValue(0.0)
        form.addRow("Yaw (rotation):", self.yaw_input)

        layout.addLayout(form)

        self.buttonBox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        self.buttonBox.accepted.connect(self.accept)
        self.buttonBox.rejected.connect(self.reject)
        layout.addWidget(self.buttonBox)

        self.setLayout(layout)

    def is_name_taken(self, name):
        scene = self.parent().scene()
        view = self.parent()

        for item in scene.items():
            if hasattr(item, "name") and item.name == name:
                return True

        if hasattr(view, "external_models"):
            for model in view.external_models:
                if model.get("name") == name:
                    return True

        return False

    def accept(self):
        self.result_data = {
            "shape": self.shape_combo.currentText(),
            "name": self.name_input.text(),
            "pose": [
                round(self.x, 3),
                round(self.y, 3),
                self.z_input.value(),
                0, 0,
                self.yaw_input.value()
            ],
            "height": self.height_input.value()
        }
        super().accept()
