# Smart RTA Analyzer 🎛️

Un Analizador de Espectro en Tiempo Real (RTA) de alto rendimiento construido en **Angular**, diseñado para aplicaciones de sonido en vivo y calibración acústica. 

Este proyecto aprovecha la **Web Audio API** nativa y la aceleración por hardware mediante **HTML5 Canvas** para entregar un análisis espectral fluido a 60fps. Ideal para integrarse en ecosistemas de monitoreo o para analizar señales provenientes de consolas digitales multicanal (como la Soundcraft Ui24R o similares) conectadas vía USB.

## 🚀 Características Principales

* **Procesamiento de Audio Crudo:** Desactiva nativamente los filtros del navegador (cancelación de eco, supresión de ruido y control de ganancia automática) para garantizar una respuesta plana ($Flat$) y mediciones precisas en decibelios.
* **Descubrimiento de Hardware:** Mapeo automático de interfaces de audio y mesas de sonido conectadas al sistema operativo.
* **Motor de Alto Rendimiento:** Loop de renderizado optimizado con `requestAnimationFrame` que no bloquea el hilo principal de la interfaz (UI).
* **Visualización Logarítmica:** Gráfico de área continua con escala de frecuencia logarítmica (20Hz a 20kHz), emulando el estándar visual de la industria del audio profesional.

## 🛠️ Stack Tecnológico

* **Frontend:** Angular (Signals, Control Flow, Standalone Components).
* **Lenguaje:** TypeScript estricto.
* **Procesamiento:** Web Audio API (`AnalyserNode`, Transformada Rápida de Fourier - FFT).
* **Entorno:** Node.js 22 + `pnpm`.

## ⚙️ Instalación y Uso

1. Clonar el repositorio.
2. Instalar dependencias con pnpm:
   ```bash
   pnpm install