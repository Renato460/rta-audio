import { Component, OnInit, signal, inject, ViewChild, ElementRef, HostListener, OnDestroy } from '@angular/core';
// Cambia la línea del import por esta:
import { AudioAnalyzer } from './services/audio-analyzer.service';

const TARGET_FREQUENCIES = [60, 250, 1000, 5000, 10000, 16000];
const TARGET_DBS = [-10, -20, -30, -40, -60, -80];
const MIN_LOG_FREQ = 20;
const FFT_SIZE = 2048;

const FB_AMP_THRESHOLD = 170; 
// 2. Isolation: Must be at least 40 units louder than its neighbors (Sharp Q-factor)
const FB_ISOLATION = 20;      
// 3. Persistence: Must sustain for 45 consecutive frames (~0.75 seconds)
const FB_FRAMES = 30;

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {

  protected readonly title = signal('rta-audio');

  public audioService = inject(AudioAnalyzer);
  // Signal local para guardar el ID del dispositivo que el usuario seleccione en el <select>
  public selectedDeviceId = signal<string>('');

  // Guardaremos el ID de la animación para poder cancelarla después
  private animationFrameId: number | null = null;

  // 2. Referencia al elemento canvas del HTML
  @ViewChild('rtaCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  // Contexto 2D para poder dibujar
  private canvasCtx: CanvasRenderingContext2D | null = null;

  private peaks: number[] = [];

  private feedbackSustain: number[] = [];

  // NUEVO: Signal para controlar si la pantalla está congelada
  public isFrozen = signal<boolean>(false);

  public hasSnapshot = signal<boolean>(false);
  private referenceData: Uint8Array | null = null;

  // NEW: View Mode state
  public viewMode = signal<'RTA' | 'SPECTROGRAM'>('RTA');
  
  // NEW: Offscreen canvas for the waterfall memory
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  ngOnInit(): void {
    this.audioService.discoverDevices();
  }

  ngOnDestroy() {
    this.stopAnimationLoop();
    this.audioService.stopListening();
  }

  // Captura el cambio de selección en el menú desplegable
  onDeviceChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    this.selectedDeviceId.set(selectElement.value);
  }

  takeSnapshot() {
    const currentData = this.audioService.getFrequencyData();
    if (currentData && currentData.length > 0) {
      // Clone the array in memory
      this.referenceData = new Uint8Array(currentData);
      this.hasSnapshot.set(true);
    }
  }

  clearSnapshot() {
    this.referenceData = null;
    this.hasSnapshot.set(false);
  }

  toggleFreeze() {
    // Solo podemos congelar si el analizador está encendido
    if (this.audioService.isListening()) {
      this.isFrozen.set(!this.isFrozen());
    }
  }

  // Gatilla el inicio de la escucha con el dispositivo seleccionado
  async toggleListening() {
    if (this.audioService.isListening()) {
      this.stopAnimationLoop();
      this.audioService.stopListening();
    } else {
      try {
        await this.audioService.startListening(this.selectedDeviceId());
        // Una vez que el servicio está escuchando con éxito, arrancamos el loop

        // 3. Obtener el contexto de dibujo una vez que iniciamos
        if (this.canvasRef) {
          this.canvasCtx = this.canvasRef.nativeElement.getContext('2d');
        }

        this.startAnimationLoop();
      } catch (error) {
        console.error('No se pudo iniciar el loop de animación debido a un error de audio.');
      }
    }
  }

  private getThermalColor(value: number): string {
    // Map 0-255 to a thermal gradient
    // Quiet = Black -> Blue -> Purple -> Red -> Loud = Yellow/White
    if (value < 10) return '#111111'; // Noise floor
    
    // Using HSL (Hue, Saturation, Lightness) for smooth color transitions
    // 240 is Blue, 0 is Red in HSL
    const hue = Math.max(0, 240 - (value / 255) * 260); 
    const lightness = Math.min(50, (value / 255) * 50 + 10);
    
    return `hsl(${hue}, 100%, ${lightness}%)`;
  }

  private drawSpectrogram(
    ctx: CanvasRenderingContext2D, data: Uint8Array, resolution: number, 
    width: number, height: number, getLogX: (f: number) => number
  ) {
    if (!this.offscreenCanvas || !this.offscreenCtx) return;

    const shiftSpeed = 2; // How fast the waterfall falls

    // 1. Shift the offscreen canvas down
    this.offscreenCtx.drawImage(
      this.offscreenCanvas, 
      0, 0, width, height - shiftSpeed, 
      0, shiftSpeed, width, height - shiftSpeed
    );

    // 2. THE FIX: Clear the new top row with our "coldest" base color.
    // This prevents the infinite smearing of silent frequencies.
    this.offscreenCtx.fillStyle = '#111111';
    this.offscreenCtx.fillRect(0, 0, width, shiftSpeed);

    // 3. Draw the new line of frequency data
    for (let i = 1; i < data.length; i++) {
      const amp = data[i];
      
      // We removed the `if (amp === 0) continue;` optimization.
      // We WANT it to paint the dark blue/black thermal color when silent.

      const freq = i * resolution;
      const x = getLogX(freq);
      
      const nextFreq = (i + 1) * resolution;
      const nextX = getLogX(nextFreq);
      const barWidth = Math.max(1, nextX - x);

      this.offscreenCtx.fillStyle = this.getThermalColor(amp);
      this.offscreenCtx.fillRect(x, 0, barWidth + 0.5, shiftSpeed); 
    }

    // 4. Stamp the entire offscreen memory onto the real, visible canvas
    ctx.drawImage(this.offscreenCanvas, 0, 0);
  }

  private drawReferenceCurve(
    ctx: CanvasRenderingContext2D, data: Uint8Array, resolution: number, 
    width: number, height: number, maxDrawHeight: number, getLogX: (f: number) => number
  ) {
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 1; i < data.length; i++) {
      const freq = i * resolution;
      const x = getLogX(freq);
      const barHeight = data[i];
      const mappedHeight = (barHeight / 255) * maxDrawHeight;
      ctx.lineTo(x, height - mappedHeight);
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    
    // Ghostly styling for the background reference
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; // Very faint white fill
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Crisp white border
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawFeedbackAlert(
    ctx: CanvasRenderingContext2D, data: Uint8Array, resolution: number, 
    width: number, height: number, getLogX: (f: number) => number
  ) {
    if (this.feedbackSustain.length !== data.length) {
      this.feedbackSustain = new Array(data.length).fill(0);
    }

    let feedbackDetected = false;
    let feedbackFreq = 0;
    let feedbackX = 0;

    for (let i = 5; i < data.length - 5; i++) {
      const amp = data[i];

      // 2. THE FIX: Widen the isolation check from 2 bins to 5 bins away
      if (
        amp > FB_AMP_THRESHOLD && 
        (amp - data[i - 5]) > FB_ISOLATION && 
        (amp - data[i + 5]) > FB_ISOLATION
      ) {
        this.feedbackSustain[i] += 1; 
      } else {
        this.feedbackSustain[i] = Math.max(0, this.feedbackSustain[i] - 2);
      }

      if (this.feedbackSustain[i] >= FB_FRAMES) {
        feedbackDetected = true;
        feedbackFreq = i * resolution;
        feedbackX = getLogX(feedbackFreq);
        
        this.feedbackSustain[i] = FB_FRAMES; 
      }
    }

    // --- VISUAL ALERT RENDERER ---
    if (feedbackDetected) {
      ctx.beginPath();
      ctx.moveTo(feedbackX, 0);
      ctx.lineTo(feedbackX, height);
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 50, 50, 1)';
      ctx.font = 'bold 22px sans-serif';
      
      const formattedFreq = feedbackFreq >= 1000 
        ? (feedbackFreq / 1000).toFixed(1) + 'k' 
        : Math.round(feedbackFreq);
        
      const text = `⚠️ FEEDBACK: ${formattedFreq}Hz`;
      
      let textX = feedbackX;
      if (textX < 120) textX = 120;
      if (textX > width - 120) textX = width - 120;

      ctx.textAlign = 'center';
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      // Made the background box slightly taller and vertically centered with the text
      ctx.fillRect(textX - (textWidth / 2) - 15, 10, textWidth + 30, 40);

      ctx.fillStyle = 'rgba(255, 50, 50, 1)';
      ctx.fillText(text, textX, 38);
      ctx.textAlign = 'left';
    }
  }

  private startAnimationLoop() {
    const loop = () => {

      if (!this.isFrozen()) {
        this.renderFrame();
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  private clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, width, height);
  }

  private drawRtaCurve(
    ctx: CanvasRenderingContext2D, data: Uint8Array, resolution: number, 
    width: number, height: number, maxDrawHeight: number, getLogX: (f: number) => number
  ) {
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(50, 200, 50, 0.8)');
    gradient.addColorStop(0.6, 'rgba(200, 200, 50, 0.8)');
    gradient.addColorStop(1, 'rgba(200, 50, 50, 0.8)');

    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 1; i < data.length; i++) {
      const freq = i * resolution;
      const x = getLogX(freq);
      const barHeight = data[i];
      const mappedHeight = (barHeight / 255) * maxDrawHeight;
      ctx.lineTo(x, height - mappedHeight);
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawPeakHold(
    ctx: CanvasRenderingContext2D, data: Uint8Array, resolution: number, 
    width: number, height: number, maxDrawHeight: number, getLogX: (f: number) => number
  ) {
    // Inicializar el arreglo si está vacío
    if (this.peaks.length !== data.length) {
      this.peaks = new Array(data.length).fill(0);
    }

    ctx.beginPath();

    for (let i = 1; i < data.length; i++) {
      const freq = i * resolution;
      const x = getLogX(freq);
      const barHeight = data[i];
      
      this.peaks[i] = Math.max(this.peaks[i] - 1.5, barHeight);
      const mappedPeakHeight = (this.peaks[i] / 255) * maxDrawHeight;

      if (i === 1) ctx.moveTo(x, height - mappedPeakHeight);
      else ctx.lineTo(x, height - mappedPeakHeight);
    }

    ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D, width: number, height: number, 
    maxDrawHeight: number, getLogX: (f: number) => number
  ) {
    // Dibujar Eje X (Hercios)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = '12px sans-serif';
    ctx.lineWidth = 1;

    TARGET_FREQUENCIES.forEach(freq => {
      const xPos = getLogX(freq);
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, height);
      ctx.stroke();
      const text = freq >= 1000 ? `${freq / 1000}k` : `${freq}Hz`;
      ctx.fillText(text, xPos + 4, height - 10);
    });

    // Dibujar Eje Y (Decibelios)
    const minDb = this.audioService.getMinDecibels();
    const maxDb = this.audioService.getMaxDecibels();
    const dbRange = maxDb - minDb;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';

    TARGET_DBS.forEach(db => {
      if (db < minDb || db > maxDb) return;
      const byteValue = ((db - minDb) / dbRange) * 255;
      const yPos = height - ((byteValue / 255) * maxDrawHeight);

      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(width, yPos);
      ctx.stroke();
      ctx.fillText(`${db} dB`, width - 5, yPos - 3);
    });
    
    ctx.textAlign = 'left';
  }

  private renderFrame() {
    const data = this.audioService.getFrequencyData();
    const ctx = this.canvasCtx;

    if (!ctx || !data || data.length === 0) return;

    const canvas = this.canvasRef.nativeElement;
    const width = canvas.width;
    const height = canvas.height;

    // --- NEW: Initialize Offscreen Canvas for Spectrogram ---
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
      
      // Fill it with a dark background initially
      if (this.offscreenCtx) {
        this.offscreenCtx.fillStyle = '#111111';
        this.offscreenCtx.fillRect(0, 0, width, height);
      }
    }

      // 1. Helpers Matemáticos Centralizados
    const sampleRate = this.audioService.getSampleRate();
    const resolution = sampleRate / FFT_SIZE;
    const maxLogFreq = sampleRate / 2;

    const getLogX = (freq: number) => {
      if (freq < MIN_LOG_FREQ) return 0;
      const minLog = Math.log10(MIN_LOG_FREQ);
      const maxLog = Math.log10(maxLogFreq);
      return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
    };

    const maxDrawHeight = height - (height * 0.05);

    // 2. Delegación del trabajo pesado a funciones específicas
    // 2. Delegación del trabajo pesado a funciones específicas
    
    if (this.viewMode() === 'RTA') {
      // --- STANDARD RTA VIEW ---
      this.clearCanvas(ctx, width, height);
      if (this.referenceData) {
        this.drawReferenceCurve(ctx, this.referenceData, resolution, width, height, maxDrawHeight, getLogX);
      }
      this.drawRtaCurve(ctx, data, resolution, width, height, maxDrawHeight, getLogX);
      this.drawPeakHold(ctx, data, resolution, width, height, maxDrawHeight, getLogX);
    } else {
      // --- SPECTROGRAM WATERFALL VIEW ---
      // We do NOT call clearCanvas here, because the waterfall stamps over the whole screen
      this.drawSpectrogram(ctx, data, resolution, width, height, getLogX);
    }

    // UI Overlays (These always draw on top, regardless of the view mode)
    this.drawGrid(ctx, width, height, maxDrawHeight, getLogX);
    this.drawFeedbackAlert(ctx, data, resolution, width, height, getLogX);
  }

  private stopAnimationLoop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;

      // Limpiar el canvas al apagar para que no quede la última imagen congelada
      if (this.canvasCtx && this.canvasRef) {
        const canvas = this.canvasRef.nativeElement;
        this.canvasCtx.fillStyle = '#111111';
        this.canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
}
