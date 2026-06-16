import { Component, OnInit, signal, inject, ViewChild, ElementRef, HostListener } from '@angular/core';
// Cambia la línea del import por esta:
import { AudioAnalyzer } from './services/audio-analyzer.service';

@Component({
  selector: 'app-root',
  standalone: true,
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

        const data = this.audioService.getFrequencyData();
        const ctx = this.canvasCtx;

        if (ctx && data && data.length > 0) {
          const canvas = this.canvasRef.nativeElement;
          const width = canvas.width;
          const height = canvas.height;

          // 1. Limpiar el frame
          ctx.fillStyle = '#111111';
          ctx.fillRect(0, 0, width, height);

          // Inicializar el arreglo de picos la primera vez que recibimos datos
          if (this.peaks.length !== data.length) {
            this.peaks = new Array(data.length).fill(0);
          }

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
          const ceilingPadding = height * 0.05;
          const maxDrawHeight = height - ceilingPadding;

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
            const mappedHeight = (barHeight / 255) * maxDrawHeight;

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

          ctx.beginPath();

          for (let i = 1; i < data.length; i++) {
            const freq = i * resolution;
            const x = getLogX(freq);
            const barHeight = data[i];

            // Lógica de Peak Hold: Si el valor actual es mayor, lo pisa. 
            // Si es menor, el pico cae lentamente restando 1.5 (ajusta este valor para cambiar la velocidad de caída)
            this.peaks[i] = Math.max(this.peaks[i] - 1.5, barHeight);

            const mappedPeakHeight = (this.peaks[i] / 255) * maxDrawHeight;

            // Dibujar la línea del pico
            if (i === 1) {
              ctx.moveTo(x, height - mappedPeakHeight);
            } else {
              ctx.lineTo(x, height - mappedPeakHeight);
            }
          }

          // Estilo de la línea de picos (un rojo/naranja brillante)
          ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
          ctx.lineWidth = 2;
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

          // ── 4. DIBUJAR EL EJE VERTICAL (Escala de Decibelios) ──────
          // Leemos los límites directamente del servicio (o usamos los que definimos)
          const minDb = this.audioService.getMinDecibels(); // -100
          const maxDb = this.audioService.getMaxDecibels(); // -10
          const dbRange = maxDb - minDb;

          // Frecuencias objetivo que queremos marcar en pantalla
          const targetDbs = [-10, -20, -30, -40, -60, -80];

          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; // Líneas muy tenues
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'right'; // Alinear el texto a la derecha

          targetDbs.forEach(db => {
            // Si el dB está fuera del rango que el analizador puede escuchar, lo saltamos
            if (db < minDb || db > maxDb) return;

            // Convertir el valor de decibelios a la escala de 0-255
            const byteValue = ((db - minDb) / dbRange) * 255;

            // Mapear el valor de 0-255 a la altura en píxeles de nuestro canvas
            const yPos = height - ((byteValue / 255) * maxDrawHeight);

            // Dibujar la línea horizontal cruzando todo el ancho
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(width, yPos);
            ctx.stroke();

            // Dibujar el texto en el extremo derecho del canvas
            ctx.fillText(`${db} dB`, width - 5, yPos - 3);
          });

          // Restaurar la alineación del texto a la izquierda para el próximo frame (importante)
          ctx.textAlign = 'left';

        }
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
