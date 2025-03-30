from PyQt6.QtWidgets import QDialog, QVBoxLayout, QFormLayout, QLineEdit, QDialogButtonBox, QDoubleSpinBox, QComboBox, QLabel, QPushButton, QMessageBox
from PyQt6.QtGui import QDoubleValidator
import os, json

class ModelInsertDialog(QDialog):
    def __init__(self, x, y, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add External Model")
        self.result_data = None

        layout = QVBoxLayout()
        form = QFormLayout()

        self.name_input = QLineEdit("ergocub")
        self.uri_input = QLineEdit("model://ergocub")
        self.z_input = QDoubleSpinBox()
        self.z_input.setRange(-1000.0, 1000.0)
        self.z_input.setDecimals(3)
        self.z_input.setSingleStep(0.1)
        self.z_input.setValue(0.5)

        self.yaw_input = QDoubleSpinBox()
        self.yaw_input.setRange(-6.283, 6.283)  # přibližně -2π až 2π
        self.yaw_input.setDecimals(3)
        self.yaw_input.setSingleStep(0.1)
        self.yaw_input.setValue(0.0)

        form.addRow("Model name:", self.name_input)
        form.addRow("Model URI:", self.uri_input)
        form.addRow("Z height (m):", self.z_input)
        form.addRow("Yaw (rad):", self.yaw_input)

        layout.addLayout(form)


        buttons = QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        self.buttonBox = QDialogButtonBox(buttons)
        self.buttonBox.accepted.connect(self.accept)
        self.buttonBox.rejected.connect(self.reject)

        layout.addWidget(self.buttonBox)

        self.preset_combo = QComboBox()
        self.presets = load_model_presets()
        self.preset_combo.addItem("Custom...")
        for name in self.presets:
            self.preset_combo.addItem(name)
        self.preset_combo.currentTextChanged.connect(self.apply_preset)
        layout.addWidget(QLabel("Preset:"))
        layout.addWidget(self.preset_combo)



        self.save_preset_btn = QPushButton("Save as Preset")
        self.save_preset_btn.clicked.connect(self.save_preset)
        layout.addWidget(self.save_preset_btn)

        self.delete_preset_btn = QPushButton("Delete Preset")
        self.delete_preset_btn.clicked.connect(self.delete_preset)
        layout.addWidget(self.delete_preset_btn)

        self.setLayout(layout)

        self.x = x
        self.y = y


    def accept(self):
        try:
            self.result_data = {
                "name": self.name_input.text(),
                "uri": self.uri_input.text(),
                "pose": [
                    round(self.x, 3),
                    round(self.y, 3),
                    self.z_input.value(),
                    0, 0,
                    self.yaw_input.value()
                ]
            }
            super().accept()
        except Exception as e:
            print(f"Dialog error: {e}")
            return

    def apply_preset(self, name):
        if name in self.presets:
            preset = self.presets[name]
            self.name_input.setText(preset["name"])
            self.uri_input.setText(preset["uri"])
            self.z_input.setValue(preset.get("z", 0.5))
            self.yaw_input.setValue(preset.get("yaw", 0.0))

    def save_preset(self):
        import os, json

        folder = "models_configs"
        os.makedirs(folder, exist_ok=True)

        name = self.name_input.text().strip()
        if not name:
            QMessageBox.warning(self, "Missing Name", "Please enter a model name before saving.")
            return

        preset = {
            "name": name,
            "uri": self.uri_input.text(),
            "z": self.z_input.value(),
            "yaw": self.yaw_input.value()
        }

        path = os.path.join(folder, f"{name}.json")
        try:
            with open(path, "w") as f:
                json.dump(preset, f, indent=2)
            QMessageBox.information(self, "Saved", f"Preset saved to {path}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save preset: {e}")

        self.reload_presets()

    def delete_preset(self):
        import os

        name = self.preset_combo.currentText()
        if name == "Custom...":
            QMessageBox.information(self, "Preset", "Cannot delete 'Custom...' entry.")
            return

        path = os.path.join("models_configs", f"{name}.json")
        if not os.path.exists(path):
            QMessageBox.warning(self, "Preset", "Preset file not found.")
            return

        confirm = QMessageBox.question(self, "Confirm Delete", f"Delete preset '{name}'?",
                                       QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if confirm == QMessageBox.StandardButton.Yes:
            try:
                os.remove(path)
                QMessageBox.information(self, "Deleted", f"Preset '{name}' deleted.")
                self.reload_presets()
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Could not delete preset: {e}")

    def reload_presets(self):
        self.presets = load_model_presets()
        self.preset_combo.clear()
        self.preset_combo.addItem("Custom...")
        for name in self.presets:
            self.preset_combo.addItem(name)


def load_model_presets():
    folder = "models_configs"
    presets = {}
    if not os.path.exists(folder):
        return presets
    for filename in os.listdir(folder):
        if filename.endswith(".json"):
            try:
                with open(os.path.join(folder, filename), "r") as f:
                    data = json.load(f)
                    presets[data["name"]] = data
            except Exception as e:
                print(f"Error loading {filename}: {e}")
    return presets