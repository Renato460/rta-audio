import { Service, signal } from '@angular/core';

@Service()
export class AudioAnalyzer {
    // Infraestructura privada de la Web Audio API
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private stream: MediaStream | null = null;

    // Array de bytes donde la FFT volcará las amplitudes en tiempo real
    private dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;

    // ── SIGNALS DE ANGULAR (Estado Reactivo para la UI) ────────────────
    // Reemplaza los BehaviorSubjects antiguos. Son más eficientes para el RTA.
    public isListening = signal<boolean>(false);
    // Nuevo Signal para que la UI conozca los dispositivos de entrada disponibles
    public audioDevices = signal<MediaDeviceInfo[]>([]);

    constructor() { }

    /**
       * Inicializa el flujo de audio desde el hardware e introduce el AnalyserNode
       * en la cadena de ganancia antes de que llegue al destino (parlantes).
       */
    async startListening(deviceId?: string): Promise<void> {
        // Si ya existía una sesión activa, la destruimos limpiamente para evitar fugas de memoria
        this.stopListening();

        try {
            // CRITERIO DE ACEPTACIÓN: Configuración de audio crudo y profesional (Mesa/Mic)
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false, // Apagado: Evita que el navegador mutee frecuencias repetitivas
                    noiseSuppression: false, // Apagado: Evita que el navegador confunda música con ruido de fondo
                    autoGainControl: false   // Apagado: Mantiene la dinámica real (dB) que entrega la mesa
                }
            };

            // 1. Capturar el stream del hardware
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 2. Inicializar el contexto de audio principal
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

            // 3. Crear el nodo de origen (origen de la señal)
            const source = this.audioContext.createMediaStreamSource(this.stream);

            // 4. Crear e inyectar el AnalyserNode
            this.analyser = this.audioContext.createAnalyser();

            // CRITERIO DE ACEPTACIÓN: FFT en 2048 para resolución espectral óptima
            this.analyser.fftSize = 2048;

            // Inicializar el tamaño del buffer de datos (Siempre es la mitad del fftSize = 1024 bins)
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>;

            // 5. Conexión de la tubería (Routing)
            // Conectamos el micrófono directo al analizador. 
            // OJO: No conectamos el analizador al 'audioContext.destination' para no generar feedback en tu PC.
            source.connect(this.analyser);

            // Actualizar estado reactivo
            this.isListening.set(true);

            const activeTrack = this.stream.getAudioTracks()[0];
            console.log(`📡 [Tech Lead] Canal de audio conectado exitosamente: "${activeTrack.label}"`);
        } catch (error) {
            console.error('❌ Error crítico al inicializar la infraestructura de audio:', error);
            this.isListening.set(false);
            throw error; // Propagamos el error por si la UI necesita manejar la alerta
        }
    }

    /**
 * Escanea el hardware del sistema, pide permisos iniciales y filtra
 * los dispositivos para quedarse solo con las entradas de audio (micrófonos/mesas).
 */
    async discoverDevices(): Promise<void> {
        try {
            // PASO CRÍTICO: Pedimos un permiso genérico breve. Si no hacemos esto, 
            // el navegador por seguridad nos devolverá las etiquetas (nombres) vacías.
            const initialPermission = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Una vez obtenido el permiso para revelar los nombres, cerramos ese stream temporal
            initialPermission.getTracks().forEach(track => track.stop());

            // Enumerar todos los dispositivos conectados a la Mac
            const devices = await navigator.mediaDevices.enumerateDevices();

            // Filtramos para dejar solo los de tipo 'audioinput' (entradas de sonido)
            const inputDevices = devices.filter(device => device.kind === 'audioinput');

            // Guardamos la lista en nuestro Signal
            this.audioDevices.set(inputDevices);
            console.log('🎛️ [Tech Lead] Dispositivos de audio detectados y mapeados:', inputDevices);
        } catch (error) {
            console.error('❌ Error al escanear dispositivos de audio:', error);
        }
    }

    /**
     * Retorna los datos de frecuencia actualizados en el instante exacto de la llamada.
     * Este método será invocado ~60 veces por segundo por el loop de renderizado.
     */
    getFrequencyData(): Uint8Array<ArrayBuffer> {
        if (this.analyser) {
            // Llena el dataArray con las amplitudes actuales (valores de 0 a 255)
            // Type assertion fixes TS issues around ArrayBufferLike vs ArrayBuffer (SharedArrayBuffer)
            this.analyser.getByteFrequencyData(this.dataArray);
        }
        return this.dataArray;
    }

    // Retorna la frecuencia de muestreo actual del hardware (ej: 44100 o 48000)
    getSampleRate(): number {
        return this.audioContext ? this.audioContext.sampleRate : 44100;
    }

    /**
   * Libera los recursos de hardware y cierra los hilos de audio del navegador.
   */
    stopListening(): void {
        // 1. Apagar físicamente el hardware (Cierra el stream y apaga el LED del mic)
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        // 2. Destruir el contexto de audio para liberar RAM
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.analyser = null;
        this.isListening.set(false);
        console.log('🛑 [Tech Lead] Infraestructura de audio liberada limpiamente.');
    }
}
