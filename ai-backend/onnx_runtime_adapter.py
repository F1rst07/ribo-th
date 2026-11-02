"""CPU ONNX implementation of the prediction interface used by server.py.

Consumes dynamic or 640px opset 17 exports; dynamic exports use the requested
inference size and skip unused letterbox rows.
No torch or model downloads are needed on the device.
"""
import ast
import os
import time
from types import SimpleNamespace

import cv2
import numpy as np
import onnxruntime as ort


class Masks:
    def __init__(self, polygons):
        self.xy = polygons

    def __len__(self):
        return len(self.xy)


def merge_contours(contours):
    """Connect external contours using Ultralytics' closest-point ordering."""
    segments = [c.reshape(-1, 2) for c in contours]
    if len(segments) == 1:
        return segments[0].astype(np.float32)
    links = [[] for _ in segments]
    for index in range(1, len(segments)):
        distances = ((segments[index - 1][:, None] - segments[index][None]) ** 2).sum(axis=2)
        first, second = np.unravel_index(distances.argmin(), distances.shape)
        links[index - 1].append(first)
        links[index].append(second)
    joined = []
    for index, indices in enumerate(links):
        if len(indices) == 2 and indices[0] > indices[1]:
            indices = [len(segments[index]) - 1 - value for value in indices]
            segments[index] = segments[index][::-1]
        segments[index] = np.roll(segments[index], -indices[0], axis=0)
        segments[index] = np.concatenate([segments[index], segments[index][:1]])
        joined.append(segments[index] if index in (0, len(segments) - 1) else segments[index][:indices[1] - indices[0] + 1])
    for index in range(len(links) - 2, 0, -1):
        joined.append(segments[index][abs(links[index][1] - links[index][0]):])
    return np.concatenate(joined).astype(np.float32)


class YOLO:
    def __init__(self, path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get("RIBO_ORT_THREADS", "2"))
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        self.session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
        metadata = self.session.get_modelmeta().custom_metadata_map
        self.names = ast.literal_eval(metadata["names"])
        self.task = metadata["task"]
        self.input = self.session.get_inputs()[0]
        self.dynamic = not isinstance(self.input.shape[2], int)
        if self.input.shape[1] != 3 or (not self.dynamic and self.input.shape != [1, 3, 640, 640]):
            raise ValueError("Device model must be a 640px or dynamic RGB export")

    def predict(self, source, conf=0.35, iou=0.45, agnostic_nms=True, **kwargs):
        start = time.perf_counter()
        height, width = source.shape[:2]
        requested_size = int(kwargs.get("imgsz", 640))
        target_size = max(32, (requested_size // 32) * 32) if self.dynamic else 640
        gain = min(target_size / height, target_size / width)
        resized = (round(width * gain), round(height * gain))
        input_w = ((resized[0] + 31) // 32) * 32 if self.dynamic else 640
        input_h = ((resized[1] + 31) // 32) * 32 if self.dynamic else 640
        pad_x, pad_y = (input_w - resized[0]) / 2, (input_h - resized[1]) / 2
        left, top = round(pad_x - 0.1), round(pad_y - 0.1)
        image = cv2.resize(source, resized, interpolation=cv2.INTER_LINEAR)
        image = cv2.copyMakeBorder(image, top, round(pad_y + 0.1), left, round(pad_x + 0.1), cv2.BORDER_CONSTANT, value=(114, 114, 114))
        tensor = np.ascontiguousarray(image[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
        pre = time.perf_counter()
        outputs = self.session.run(None, {self.input.name: tensor})
        inferred = time.perf_counter()
        rows = outputs[0][0].T
        count = len(self.names)
        classes = rows[:, 4:4 + count].argmax(axis=1)
        scores = rows[np.arange(len(rows)), 4 + classes]
        selected = scores > conf
        rows, classes, scores = rows[selected], classes[selected], scores[selected]
        xyxy = rows[:, :4].copy()
        xyxy[:, :2] = rows[:, :2] - rows[:, 2:4] / 2
        xyxy[:, 2:4] = rows[:, :2] + rows[:, 2:4] / 2
        order = scores.argsort()[::-1][:30000]
        keep = []
        while len(order) and len(keep) < 300:
            index = order[0]
            keep.append(index)
            remaining = order[1:]
            lo = np.maximum(xyxy[index, :2], xyxy[remaining, :2])
            hi = np.minimum(xyxy[index, 2:], xyxy[remaining, 2:])
            intersection = np.maximum(hi - lo, 0).prod(axis=1)
            areas = np.maximum(xyxy[:, 2:] - xyxy[:, :2], 0).prod(axis=1)
            overlap = intersection / (areas[index] + areas[remaining] - intersection + 1e-7)
            if not agnostic_nms:
                overlap *= classes[remaining] == classes[index]
            order = remaining[overlap <= iou]
        polygons, boxes = [], []
        for index in keep:
            coords = xyxy[index].copy()
            coords[[0, 2]] = np.clip((coords[[0, 2]] - left) / gain, 0, width)
            coords[[1, 3]] = np.clip((coords[[1, 3]] - top) / gain, 0, height)
            if self.task == "segment":
                proto = outputs[1][0]
                mask = (rows[index, 4 + count:] @ proto.reshape(proto.shape[0], -1)).reshape(proto.shape[1:])
                # Upsample before cropping so interpolation cannot smear a mask
                # beyond its detection box (Ultralytics process_mask).
                mask = (cv2.resize(mask, (input_w, input_h), interpolation=cv2.INTER_LINEAR) > 0).astype(np.uint8)
                x1, y1, x2, y2 = xyxy[index]
                mask *= (np.arange(input_w)[None, :] >= x1) & (np.arange(input_w)[None, :] < x2)
                mask *= (np.arange(input_h)[:, None] >= y1) & (np.arange(input_h)[:, None] < y2)
                contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                polygon = merge_contours(contours) if contours else np.empty((0, 2), np.float32)
                if len(polygon):
                    polygon[:, 0] = np.clip((polygon[:, 0] - left) / gain, 0, width)
                    polygon[:, 1] = np.clip((polygon[:, 1] - top) / gain, 0, height)
                polygons.append(polygon)
            boxes.append(SimpleNamespace(xyxy=coords[None], conf=np.array(scores[index]), cls=np.array(classes[index])))
        return [SimpleNamespace(boxes=boxes, masks=Masks(polygons) if polygons else None,
                                speed={"preprocess": (pre-start)*1000, "inference": (inferred-pre)*1000,
                                       "postprocess": (time.perf_counter()-inferred)*1000})]
