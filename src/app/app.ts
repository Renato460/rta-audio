import { Component, OnInit, signal, inject, ViewChild, ElementRef, HostListener, OnDestroy } from '@angular/core';
// Cambia la línea del import por esta:
import { AudioAnalyzer } from './services/audio-analyzer.service';

const TARGET_FREQUENCIES = [60, 250, 1000, 5000, 10000, 16000];
const TARGET_DBS = [-10, -20, -30, -40, -60, -80];
const MIN_LOG_FREQ = 20;
const FFT_SIZE = 2048;

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

  // NUEVO: Signal para controlar si la pantalla está congelada
  public isFrozen = signal<boolean>(false);

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

  toggleFreeze() {
    // Solo podemos congelar si el analizador está encendido
    if (this.audioService.isListening()) {
      this.isFrozen.set(!this.isFrozen());
    }
  }

  // NUEVO: Escuchamos la barra espaciadora en toda la ventana
  @HostListener('window:keydown.space', ['$event'])
  handleSpacebar(event: Event) {
    // Evitamos que la barra espaciadora haga scroll hacia abajo en la página
    const kbdEvent = event as KeyboardEvent;

    kbdEvent.preventDefault();
    this.toggleFreeze();
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
    this.clearCanvas(ctx, width, height);
    this.drawRtaCurve(ctx, data, resolution, width, height, maxDrawHeight, getLogX);
    this.drawPeakHold(ctx, data, resolution, width, height, maxDrawHeight, getLogX);
    this.drawGrid(ctx, width, height, maxDrawHeight, getLogX);
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
