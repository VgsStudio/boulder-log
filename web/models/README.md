# Modelo de detecção de agarras

`holds-yolov8n-fp16.onnx` é o [jwlarocque/yolov8n-freeclimbs-detect-2](https://huggingface.co/jwlarocque/yolov8n-freeclimbs-detect-2)
(YOLOv8n ajustado para detectar agarras de escalada; 1 classe; entrada fixa 2560×2560, float16),
sem modificações. Licença AGPL-3.0 (arquivo `LICENSE` nesta pasta), herdada do Ultralytics YOLOv8.
O código-fonte deste app é público em https://github.com/VgsStudio/boulder-log, como a AGPL exige.

Roda no navegador com onnxruntime-web (`web/src/detect.js`); a cor de cada agarra e o
agrupamento da via são do próprio app (`color.js`, `detect.js`).
