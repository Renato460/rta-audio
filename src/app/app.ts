import { Component, OnInit, signal, inject, ViewChild, ElementRef } from '@angular/core';
// Cambia la línea del import por esta:
import { AudioAnalyzer } from './services/audio-analyzer.service';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {

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
      const data = this.audioService.getFrequencyData();
      const ctx = this.canvasCtx;

      if (ctx && data && data.length > 0) {
        const canvas = this.canvasRef.nativeElement;
        const width = canvas.width;
        const height = canvas.height;

        // 1. Limpiar el frame
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, width, height);

        const sampleRate = this.audioService.getSampleRate();
        const fftSize = 2048; 
        const resolution = sampleRate / fftSize;
        const minLogFreq = 20; 
        const maxLogFreq = sampleRate / 2; 

        const getLogX = (freq: number) => {
          if (freq < minLogFreq) return 0;
          const minLog = Math.log10(minLogFreq);
          const maxLog = Math.log10(maxLogFreq);
          const logFreq = Math.log10(freq);
          return ((logFreq - minLog) / (maxLog - minLog)) * width;
        };

        // ── 2. DIBUJAR LA CURVA DEL RTA (Área Continua) ────────────
        
        // Crear un gradiente de color vertical (Verde abajo, Amarillo medio, Rojo arriba)
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, 'rgba(50, 200, 50, 0.8)');   // Bajos niveles
        gradient.addColorStop(0.6, 'rgba(200, 200, 50, 0.8)'); // Medios niveles
        gradient.addColorStop(1, 'rgba(200, 50, 50, 0.8)');   // Clipping / Picos

        ctx.beginPath();
        // Empezar el trazo en la esquina inferior izquierda
        ctx.moveTo(0, height);

        // Trazar una línea conectando cada punto de frecuencia
        for (let i = 1; i < data.length; i++) {
          const freq = i * resolution;
          const x = getLogX(freq);
          const barHeight = data[i];
          const mappedHeight = (barHeight / 255) * height;

          // Dibujar la línea hasta el pico actual
          ctx.lineTo(x, height - mappedHeight);
        }

        // Bajar la línea hasta la esquina inferior derecha para cerrar la figura
        ctx.lineTo(width, height);
        ctx.closePath();

        // Rellenar la figura completa con el gradiente y darle un borde
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── 3. DIBUJAR EL EJE FRECUENCIAL (Guías) ──────────────────
        const targetFrequencies = [60, 250, 1000, 5000, 10000, 16000];
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // Líneas más tenues para no ensuciar la curva
        ctx.font = '12px sans-serif';
        ctx.lineWidth = 1;

        targetFrequencies.forEach(freq => {
          const xPos = getLogX(freq);

          ctx.beginPath();
          ctx.moveTo(xPos, 0);
          ctx.lineTo(xPos, height);
          ctx.stroke();

          const text = freq >= 1000 ? `${freq / 1000}k` : `${freq}Hz`;
          ctx.fillText(text, xPos + 4, height - 10);
        });
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
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
