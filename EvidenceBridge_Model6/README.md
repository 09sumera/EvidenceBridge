
# EvidenceBridge Model 6 — Document Recognition

Architecture: MobileNetV3-Small
Task: English medical document image classification
Classes: 5
Input: RGB, 224x224
Output: 5 class logits

## Classes
- discharge_summary
- laboratory_report
- medical_billing
- other_unsupported
- prescription

## Installation
pip install -r requirements.txt

## Usage
python inference/predict.py path/to/document.jpg

## Integration
Import predict from inference.predict and call:
result = predict("document.jpg")

Returns predicted_class, confidence and probabilities.

## Model files
model/mobilenetv3_small.onnx
model/mobilenetv3_small_best.pth

## Evaluation
See evaluation/ for the held-out test report and confusion matrix.

Note: Reported evaluation reflects this dataset and does not establish
general real-world performance.
