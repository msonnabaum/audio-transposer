interface WorkerMessage {
  type: "init" | "process";
  data?: any;
}

interface WorkerResponse {
  type: "ready" | "progress" | "complete" | "error";
  data?: any;
}

export class PitchShifter {
  private worker: Worker | null = null;
  private initialized = false;
  private workerReady = false;

  async init() {
    if (this.initialized) return;

    try {
      console.log("Initializing pitch shifter worker...");

      this.worker = new Worker(
        new URL("./pitch-shifter.worker.ts", import.meta.url),
        {
          type: "module",
        }
      );

      this.worker.onerror = (error) => {
        console.error("Worker error:", error);
      };

      await this.initWorker();
      this.initialized = true;
      console.log("Pitch shifter worker initialized successfully");
    } catch (error) {
      console.error("Failed to initialize pitch shifter worker:", error);
      throw new Error(
        `Failed to initialize pitch shifter: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async initWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not created"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Worker initialization timeout"));
      }, 10000);

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type, data } = event.data;

        if (type === "ready") {
          clearTimeout(timeout);
          this.workerReady = true;
          resolve();
        } else if (type === "error") {
          clearTimeout(timeout);
          reject(new Error(data));
        }
      };

      this.worker.postMessage({ type: "init" } as WorkerMessage);
    });
  }

  async shiftPitch(
    audioBuffer: AudioBuffer,
    semitones: number,
    tempo: number = 1.0,
    onProgress?: (progress: number) => void
  ): Promise<AudioBuffer> {
    if (!this.initialized || !this.worker || !this.workerReady) {
      throw new Error("Pitch shifter not initialized");
    }

    if (semitones === 0 && tempo === 1.0) {
      return audioBuffer;
    }

    try {
      console.log(
        `Shifting pitch by ${semitones} semitones and tempo to ${tempo}x...`
      );

      if (typeof semitones !== "number" || !isFinite(semitones)) {
        throw new Error(`Invalid semitones value: ${semitones}`);
      }

      if (typeof tempo !== "number" || !isFinite(tempo) || tempo <= 0) {
        throw new Error(`Invalid tempo value: ${tempo}`);
      }

      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;

      if (!isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error(`Invalid sample rate: ${sampleRate}`);
      }
      if (!isFinite(channels) || channels <= 0) {
        throw new Error(`Invalid channels: ${channels}`);
      }

      const audioData: Float32Array[] = [];
      for (let i = 0; i < channels; i++) {
        audioData.push(audioBuffer.getChannelData(i));
      }

      const outputChannels = await this.processInWorker(
        {
          audioData,
          sampleRate,
          channels,
          semitones,
          tempo,
        },
        onProgress
      );

      const outputLength = outputChannels[0].length;
      const outputBuffer = new AudioContext().createBuffer(
        channels,
        outputLength,
        sampleRate
      );

      for (let i = 0; i < channels; i++) {
        outputBuffer.copyToChannel(outputChannels[i], i);
      }

      console.log("Pitch shifting completed successfully");
      return outputBuffer;
    } catch (error) {
      console.error("Error during pitch shifting:", error);
      throw new Error(
        `Pitch shifting failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async processInWorker(
    data: {
      audioData: Float32Array[];
      sampleRate: number;
      channels: number;
      semitones: number;
      tempo?: number;
    },
    onProgress?: (progress: number) => void
  ): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not available"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Worker processing timeout"));
      }, 30000);

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type, data: responseData } = event.data;

        switch (type) {
          case "progress":
            if (onProgress) {
              onProgress(responseData.progress);
            }
            break;
          case "complete":
            clearTimeout(timeout);
            resolve(responseData.outputChannels);
            break;
          case "error":
            clearTimeout(timeout);
            reject(new Error(responseData));
            break;
        }
      };

      this.worker.postMessage({
        type: "process",
        data,
      } as WorkerMessage);
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
    this.workerReady = false;
  }

  semitonesToRatio(semitones: number): number {
    return Math.pow(2, semitones / 12);
  }

  ratioToSemitones(ratio: number): number {
    return 12 * Math.log2(ratio);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
