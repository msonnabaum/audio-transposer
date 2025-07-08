interface WorkerMessage {
  type: 'init' | 'process';
  data?: any;
}

interface ProcessMessage {
  audioData: Float32Array[];
  sampleRate: number;
  channels: number;
  semitones: number;
}

interface WorkerResponse {
  type: 'ready' | 'progress' | 'complete' | 'error';
  data?: any;
}

class PitchShifterWorker {
  private module: any = null;
  private initialized = false;
  private wrappedFunctions: any = {};

  constructor() {
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  private async handleMessage(event: MessageEvent<WorkerMessage>) {
    const { type, data } = event.data;

    try {
      switch (type) {
        case 'init':
          await this.init();
          break;
        case 'process':
          await this.processAudio(data as ProcessMessage);
          break;
        default:
          throw new Error(`Unknown message type: ${type}`);
      }
    } catch (error) {
      this.postMessage({
        type: 'error',
        data: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async init() {
    if (this.initialized) {
      this.postMessage({ type: 'ready' });
      return;
    }

    try {
      const RubberbandModule = await import("@echogarden/rubberband-wasm");
      this.module = await RubberbandModule.default();

      this.wrappedFunctions = {
        rubberband_new: this.module.cwrap("rubberband_new", "number", [
          "number", "number", "number", "number", "number"
        ]),
        rubberband_delete: this.module.cwrap("rubberband_delete", "void", ["number"]),
        rubberband_reset: this.module.cwrap("rubberband_reset", "void", ["number"]),
        rubberband_set_pitch_scale: this.module.cwrap("rubberband_set_pitch_scale", "void", ["number", "number"]),
        rubberband_set_time_ratio: this.module.cwrap("rubberband_set_time_ratio", "void", ["number", "number"]),
        rubberband_process: this.module.cwrap("rubberband_process", "void", ["number", "number", "number", "number"]),
        rubberband_available: this.module.cwrap("rubberband_available", "number", ["number"]),
        rubberband_retrieve: this.module.cwrap("rubberband_retrieve", "number", ["number", "number", "number"]),
        rubberband_get_samples_required: this.module.cwrap("rubberband_get_samples_required", "number", ["number"]),
        rubberband_set_max_process_size: this.module.cwrap("rubberband_set_max_process_size", "void", ["number", "number"]),
        rubberband_get_latency: this.module.cwrap("rubberband_get_latency", "number", ["number"]),
        rubberband_study: this.module.cwrap("rubberband_study", "void", ["number", "number", "number", "number"]),
        rubberband_set_expected_input_duration: this.module.cwrap("rubberband_set_expected_input_duration", "void", ["number", "number"])
      };

      this.initialized = true;
      this.postMessage({ type: 'ready' });
    } catch (error) {
      throw new Error(`Failed to initialize RubberBand: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processAudio(message: ProcessMessage) {
    if (!this.initialized || !this.module) {
      throw new Error("Worker not initialized");
    }

    const { audioData, sampleRate, channels, semitones } = message;

    if (semitones === 0) {
      this.postMessage({
        type: 'complete',
        data: { outputChannels: audioData }
      });
      return;
    }

    const inputLength = audioData[0].length;
    const pitchRatio = Math.pow(2, semitones / 12);
    const timeRatio = 1.0;

    const options = 0x00000010 | 0x00000800 | 0x00000200;

    const stretcher = this.wrappedFunctions.rubberband_new(
      Math.floor(sampleRate),
      Math.floor(channels),
      0,
      1,
      1
    );

    if (!stretcher) {
      throw new Error("Failed to create RubberBand stretcher");
    }

    try {
      this.wrappedFunctions.rubberband_set_time_ratio(stretcher, timeRatio);
      this.wrappedFunctions.rubberband_set_pitch_scale(stretcher, pitchRatio);
      this.wrappedFunctions.rubberband_set_expected_input_duration(stretcher, inputLength);

      const samplesRequired = this.wrappedFunctions.rubberband_get_samples_required(stretcher);
      this.wrappedFunctions.rubberband_set_max_process_size(stretcher, samplesRequired);

      const outputChannels = await this.processAudioWithStudy(
        stretcher,
        audioData,
        inputLength,
        channels,
        samplesRequired
      );

      this.postMessage({
        type: 'complete',
        data: { outputChannels }
      });
    } finally {
      this.wrappedFunctions.rubberband_delete(stretcher);
    }
  }

  private async processAudioWithStudy(
    stretcher: number,
    inputChannels: Float32Array[],
    inputLength: number,
    channels: number,
    samplesRequired: number
  ): Promise<Float32Array[]> {
    const outputChunks: Float32Array[][] = [];
    const inputPtrs = this.module._malloc(channels * 4);
    const outputPtrs = this.module._malloc(channels * 4);

    const channelDataPtrs: number[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const bufferPtr = this.module._malloc(samplesRequired * 4);
      channelDataPtrs.push(bufferPtr);
      this.module.HEAPU32[(inputPtrs >> 2) + ch] = bufferPtr;
    }

    try {
      let read = 0;

      while (read < inputLength) {
        const chunkSize = Math.min(samplesRequired, inputLength - read);
        const isFinal = read + chunkSize >= inputLength;

        for (let ch = 0; ch < channels; ch++) {
          const inputData = inputChannels[ch].subarray(read, read + chunkSize);
          this.module.HEAPF32.set(inputData, channelDataPtrs[ch] >> 2);
        }

        this.wrappedFunctions.rubberband_study(stretcher, inputPtrs, chunkSize, isFinal ? 1 : 0);
        read += chunkSize;

        const progress = (read / inputLength) * 50;
        this.postMessage({
          type: 'progress',
          data: { progress }
        });
      }

      read = 0;
      while (read < inputLength) {
        const chunkSize = Math.min(samplesRequired, inputLength - read);
        const isFinal = read + chunkSize >= inputLength;

        for (let ch = 0; ch < channels; ch++) {
          const inputData = inputChannels[ch].subarray(read, read + chunkSize);
          this.module.HEAPF32.set(inputData, channelDataPtrs[ch] >> 2);
        }

        this.wrappedFunctions.rubberband_process(stretcher, inputPtrs, chunkSize, isFinal ? 1 : 0);
        this.tryRetrieveOutput(stretcher, outputPtrs, outputChunks, channels, samplesRequired, false);

        read += chunkSize;

        const progress = 50 + (read / inputLength) * 50;
        this.postMessage({
          type: 'progress',
          data: { progress }
        });
      }

      this.tryRetrieveOutput(stretcher, outputPtrs, outputChunks, channels, samplesRequired, true);

      const totalLength = outputChunks.reduce((sum, chunk) => sum + chunk[0].length, 0);
      const outputChannels: Float32Array[] = [];

      for (let ch = 0; ch < channels; ch++) {
        const channelData = new Float32Array(totalLength);
        let offset = 0;

        for (const chunk of outputChunks) {
          channelData.set(chunk[ch], offset);
          offset += chunk[ch].length;
        }

        outputChannels.push(channelData);
      }

      return outputChannels;
    } finally {
      channelDataPtrs.forEach(ptr => this.module._free(ptr));
      this.module._free(inputPtrs);
      this.module._free(outputPtrs);
    }
  }

  private tryRetrieveOutput(
    stretcher: number,
    outputPtrs: number,
    outputChunks: Float32Array[][],
    channels: number,
    samplesRequired: number,
    final: boolean
  ) {
    while (true) {
      const available = this.wrappedFunctions.rubberband_available(stretcher);
      if (available < 1) break;
      if (!final && available < samplesRequired) break;

      const outputBuffers: number[] = [];
      try {
        for (let ch = 0; ch < channels; ch++) {
          const outputBuffer = this.module._malloc(available * 4);
          outputBuffers.push(outputBuffer);
          this.module.HEAPU32[(outputPtrs >> 2) + ch] = outputBuffer;
        }

        const retrieved = this.wrappedFunctions.rubberband_retrieve(
          stretcher,
          outputPtrs,
          Math.min(samplesRequired, available)
        );

        if (retrieved > 0) {
          const outputChunk: Float32Array[] = [];
          for (let ch = 0; ch < channels; ch++) {
            const outputData = new Float32Array(retrieved);
            outputData.set(
              this.module.HEAPF32.subarray(
                outputBuffers[ch] >> 2,
                (outputBuffers[ch] >> 2) + retrieved
              )
            );
            outputChunk.push(outputData);
          }
          outputChunks.push(outputChunk);
        }
      } finally {
        outputBuffers.forEach(buffer => this.module._free(buffer));
      }
    }
  }

  private postMessage(message: WorkerResponse) {
    self.postMessage(message);
  }
}

new PitchShifterWorker();