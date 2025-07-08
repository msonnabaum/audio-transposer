export class PitchShifter {
  private module: any = null;
  private initialized = false;
  private wrappedFunctions: any = {};

  async init() {
    if (this.initialized) return;

    try {
      // Dynamic import of the WASM module
      const RubberbandModule = await import('@echogarden/rubberband-wasm');
      
      console.log('Loading Rubber Band WASM...');
      this.module = await RubberbandModule.default();
      
      // Wrap the C functions for JavaScript use  
      this.wrappedFunctions = {
        rubberband_new: this.module.cwrap('rubberband_new', 'number', ['number', 'number', 'number', 'number', 'number']),
        rubberband_delete: this.module.cwrap('rubberband_delete', 'void', ['number']),
        rubberband_reset: this.module.cwrap('rubberband_reset', 'void', ['number']),
        rubberband_set_pitch_scale: this.module.cwrap('rubberband_set_pitch_scale', 'void', ['number', 'number']),
        rubberband_set_time_ratio: this.module.cwrap('rubberband_set_time_ratio', 'void', ['number', 'number']),
        rubberband_process: this.module.cwrap('rubberband_process', 'void', ['number', 'number', 'number', 'number']),
        rubberband_available: this.module.cwrap('rubberband_available', 'number', ['number']),
        rubberband_retrieve: this.module.cwrap('rubberband_retrieve', 'number', ['number', 'number', 'number']),
        rubberband_get_samples_required: this.module.cwrap('rubberband_get_samples_required', 'number', ['number']),
        rubberband_set_max_process_size: this.module.cwrap('rubberband_set_max_process_size', 'void', ['number', 'number']),
        rubberband_get_latency: this.module.cwrap('rubberband_get_latency', 'number', ['number'])
      };
      
      this.initialized = true;
      console.log('Rubber Band WASM loaded successfully');
    } catch (error) {
      console.error('Failed to load Rubber Band WASM:', error);
      throw new Error(`Failed to initialize pitch shifter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async shiftPitch(audioBuffer: AudioBuffer, semitones: number): Promise<AudioBuffer> {
    if (!this.initialized || !this.module) {
      throw new Error('Pitch shifter not initialized');
    }

    if (semitones === 0) {
      return audioBuffer;
    }

    try {
      console.log(`Shifting pitch by ${semitones} semitones...`);
      
      // Validate input parameters
      if (typeof semitones !== 'number' || !isFinite(semitones)) {
        throw new Error(`Invalid semitones value: ${semitones}`);
      }
      
      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;
      const inputLength = audioBuffer.length;
      
      // Calculate pitch ratio with validation
      const pitchRatio = Math.pow(2, semitones / 12);
      
      if (!isFinite(pitchRatio) || pitchRatio <= 0) {
        throw new Error(`Invalid pitch ratio calculated: ${pitchRatio} from semitones: ${semitones}`);
      }
      
      console.log(`Pitch ratio: ${pitchRatio}`);
      
      // RubberBand options - use a simpler configuration first
      const RubberBandOptionProcessOffline = 0x00000000;
      const RubberBandOptionStretchElastic = 0x00000000; // Default stretching
      const RubberBandOptionTransientsMixed = 0x00000000; // Default transients
      const RubberBandOptionDetectorCompound = 0x00000000; // Default detector
      const RubberBandOptionPhaseLaminar = 0x00000000; // Default phase
      const RubberBandOptionThreadingNever = 0x00000010; // No threading
      const RubberBandOptionWindowStandard = 0x00000000; // Default window
      const RubberBandOptionSmoothingOff = 0x00000800; // Turn off smoothing
      const RubberBandOptionFormantShifted = 0x00000000; // Default formants
      const RubberBandOptionPitchHighQuality = 0x00000200; // High quality pitch
      
      const options = RubberBandOptionProcessOffline | 
                     RubberBandOptionThreadingNever |
                     RubberBandOptionSmoothingOff |
                     RubberBandOptionPitchHighQuality;
      
      // Validate all constructor parameters
      if (!isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error(`Invalid sample rate: ${sampleRate}`);
      }
      if (!isFinite(channels) || channels <= 0) {
        throw new Error(`Invalid channels: ${channels}`);
      }
      if (!isFinite(options)) {
        throw new Error(`Invalid options: ${options}`);
      }
      
      console.log('Creating stretcher with:', { 
        sampleRate: +sampleRate, 
        channels: +channels, 
        options: +options, 
        pitchRatio 
      });
      
      // Force parameters to be integers/numbers and include initial ratios
      const timeRatio = 1.0;
      const stretcher = this.wrappedFunctions.rubberband_new(
        Math.floor(+sampleRate), 
        Math.floor(+channels), 
        Math.floor(+options),
        +timeRatio,      // Initial time ratio
        +pitchRatio      // Initial pitch ratio
      );
      console.log('Stretcher created:', stretcher, 'type:', typeof stretcher);
      
      if (!stretcher) {
        throw new Error('Failed to create RubberBand stretcher');
      }

      try {
        // Set max process size FIRST
        const maxProcessSize = 4096;
        console.log('Setting max process size to', maxProcessSize);
        this.wrappedFunctions.rubberband_set_max_process_size(stretcher, maxProcessSize);
        
        // Call study first if available (helps with analysis)
        if (this.wrappedFunctions.rubberband_study) {
          console.log('Calling study method');
          // Study some samples first for better analysis
          const studySize = Math.min(1024, inputLength);
          // We'll implement study call here if needed
        }
        
        // Set ratios using explicit number values
        const timeRatio = 1.0;
        console.log('About to set time ratio:', timeRatio, 'stretcher:', stretcher);
        this.wrappedFunctions.rubberband_set_time_ratio(stretcher, +timeRatio); // Force number conversion
        console.log('Time ratio set to', timeRatio);
        
        console.log('About to set pitch scale:', pitchRatio, 'stretcher:', stretcher);
        this.wrappedFunctions.rubberband_set_pitch_scale(stretcher, +pitchRatio); // Force number conversion
        console.log('Pitch scale set to', pitchRatio);

        // Prepare input data
        const inputChannels: Float32Array[] = [];
        for (let i = 0; i < channels; i++) {
          inputChannels.push(audioBuffer.getChannelData(i));
        }

        // Process the audio
        const outputChannels = await this.processAudio(stretcher, inputChannels, inputLength, channels, maxProcessSize);

        // Create output AudioBuffer
        const outputLength = outputChannels[0].length;
        const outputBuffer = new AudioContext().createBuffer(channels, outputLength, sampleRate);
        
        for (let i = 0; i < channels; i++) {
          outputBuffer.copyToChannel(outputChannels[i], i);
        }

        console.log('Pitch shifting completed successfully');
        return outputBuffer;
        
      } finally {
        // Clean up stretcher
        this.wrappedFunctions.rubberband_delete(stretcher);
      }
      
    } catch (error) {
      console.error('Error during pitch shifting:', error);
      throw new Error(`Pitch shifting failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processAudio(
    stretcher: number,
    inputChannels: Float32Array[],
    inputLength: number,
    channels: number,
    maxProcessSize: number
  ): Promise<Float32Array[]> {
    
    const outputChunks: Float32Array[][] = [];
    
    // Allocate memory for input and output pointers
    const inputPtrs = this.module._malloc(channels * 4); // 4 bytes per pointer
    const outputPtrs = this.module._malloc(channels * 4);
    
    try {
      // Process in chunks
      for (let offset = 0; offset < inputLength; offset += maxProcessSize) {
        const chunkSize = Math.min(maxProcessSize, inputLength - offset);
        const isLastChunk = offset + chunkSize >= inputLength;
        
        // Allocate memory for this chunk
        const inputBuffers: number[] = [];
        const outputBuffers: number[] = [];
        
        try {
          // Allocate input buffers and copy data
          for (let ch = 0; ch < channels; ch++) {
            const inputBuffer = this.module._malloc(chunkSize * 4); // 4 bytes per float
            inputBuffers.push(inputBuffer);
            
            // Copy JavaScript data to WASM heap
            const inputData = inputChannels[ch].subarray(offset, offset + chunkSize);
            this.module.HEAPF32.set(inputData, inputBuffer >> 2);
            
            // Set pointer
            this.module.HEAPU32[(inputPtrs >> 2) + ch] = inputBuffer;
          }

          // Process this chunk
          this.wrappedFunctions.rubberband_process(stretcher, inputPtrs, chunkSize, isLastChunk ? 1 : 0);

          // Retrieve output
          const available = this.wrappedFunctions.rubberband_available(stretcher);
          if (available > 0) {
            // Allocate output buffers
            for (let ch = 0; ch < channels; ch++) {
              const outputBuffer = this.module._malloc(available * 4);
              outputBuffers.push(outputBuffer);
              this.module.HEAPU32[(outputPtrs >> 2) + ch] = outputBuffer;
            }

            // Retrieve processed audio
            const retrieved = this.wrappedFunctions.rubberband_retrieve(stretcher, outputPtrs, available);
            
            // Copy output data back to JavaScript
            const outputChunk: Float32Array[] = [];
            for (let ch = 0; ch < channels; ch++) {
              const outputData = new Float32Array(retrieved);
              outputData.set(this.module.HEAPF32.subarray(outputBuffers[ch] >> 2, (outputBuffers[ch] >> 2) + retrieved));
              outputChunk.push(outputData);
            }
            outputChunks.push(outputChunk);
          }
          
        } finally {
          // Free chunk buffers
          inputBuffers.forEach(buffer => this.module._free(buffer));
          outputBuffers.forEach(buffer => this.module._free(buffer));
        }
      }

      // Combine all output chunks
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
      // Free pointer arrays
      this.module._free(inputPtrs);
      this.module._free(outputPtrs);
    }
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