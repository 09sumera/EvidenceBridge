
import json
import numpy as np
import onnxruntime as ort
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

with open(ROOT / "config/class_labels.json") as f:
    CLASSES = json.load(f)

with open(ROOT / "config/preprocessing.json") as f:
    CONFIG = json.load(f)

SESSION = ort.InferenceSession(
    str(ROOT / "model/mobilenetv3_small.onnx"),
    providers=["CPUExecutionProvider"]
)

def predict(image_path):
    image = Image.open(image_path).convert("RGB")
    image = image.resize(tuple(CONFIG["image_size"]))

    array = np.asarray(image, dtype=np.float32) / 255.0

    mean = np.array(CONFIG["normalization"]["mean"])
    std = np.array(CONFIG["normalization"]["std"])

    array = (array - mean) / std
    array = np.transpose(array, (2, 0, 1))
    array = np.expand_dims(array, axis=0).astype(np.float32)

    logits = SESSION.run(
        ["logits"],
        {"image": array}
    )[0][0]

    probabilities = np.exp(logits - np.max(logits))
    probabilities /= probabilities.sum()

    index = int(np.argmax(probabilities))

    return {
        "predicted_class": CLASSES[index],
        "confidence": float(probabilities[index]),
        "probabilities": {
            name: float(probabilities[i])
            for i, name in enumerate(CLASSES)
        }
    }

if __name__ == "__main__":
    import sys
    print(json.dumps(predict(sys.argv[1]), indent=4))
