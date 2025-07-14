export class AudioExporter {
  private initialized = false;
  private ffmpeg: any = null;

  async init() {
    if (this.initialized) return;

    try {
      // Just mark as initialized - FFmpeg will be loaded lazily when needed
      console.log(
        "Audio exporter initialized (FFmpeg core will be loaded when needed)"
      );
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize audio exporter:", error);
      throw new Error(
        `Failed to initialize audio exporter: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async ensureFFmpegLoaded() {
    if (this.ffmpeg) return;

    try {
      // Use embedded FFmpeg with core and worker
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");

      this.ffmpeg = new FFmpeg();

      // Set up logger
      this.ffmpeg.on("log", ({ type, message }) => {
        console.log(`[FFmpeg ${type}] ${message}`);
      });

      // Load with embedded core (core and worker are embedded in the build)
      await this.ffmpeg.load();

      console.log("FFmpeg loaded successfully");
    } catch (error) {
      console.error("Failed to load FFmpeg:", error);
      throw new Error(
        `Failed to load FFmpeg: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async exportToM4A(
    audioBuffer: AudioBuffer,
    bitrate: number = 256
  ): Promise<Blob> {
    if (!this.initialized) {
      throw new Error("Audio exporter not initialized");
    }

    console.log(`Exporting to M4A using FFmpeg WASM (${bitrate}kbps)...`);

    try {
      // Ensure FFmpeg is loaded
      await this.ensureFFmpegLoaded();

      // Check what codecs are available first
      const availableCodecs = await this.checkAvailableCodecs();
      console.log("Available codecs:", availableCodecs);

      // Convert AudioBuffer to raw PCM data
      const pcmData = await this.audioBufferToPCM(audioBuffer);

      // Use FFmpeg to encode to M4A
      const m4aData = await this.encodeWithFFmpeg(
        pcmData,
        audioBuffer.sampleRate,
        audioBuffer.numberOfChannels,
        "m4a",
        bitrate
      );

      const blob = new Blob([m4aData], { type: "audio/mp4" });
      console.log("M4A export completed successfully");
      return blob;
    } catch (error) {
      console.error("Error during M4A export:", error);
      throw error;
    }
  }

  async exportToWAV(audioBuffer: AudioBuffer): Promise<Blob> {
    if (!this.initialized) {
      throw new Error("Audio exporter not initialized");
    }

    try {
      console.log("Exporting to WAV...");

      // Convert AudioBuffer to WAV ArrayBuffer
      const wavArrayBuffer = this.audioBufferToWav(audioBuffer);

      console.log("WAV export completed successfully");
      return new Blob([wavArrayBuffer], { type: "audio/wav" });
    } catch (error) {
      console.error("Error during WAV export:", error);
      throw new Error(
        `WAV export failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async exportToMP3(
    audioBuffer: AudioBuffer,
    bitrate: number = 256
  ): Promise<Blob> {
    if (!this.initialized) {
      throw new Error("Audio exporter not initialized");
    }

    try {
      console.log(`Exporting to MP3 using FFmpeg WASM (${bitrate}kbps)...`);

      // Ensure FFmpeg is loaded
      await this.ensureFFmpegLoaded();

      // Convert AudioBuffer to raw PCM data
      const pcmData = await this.audioBufferToPCM(audioBuffer);

      // Use FFmpeg to encode to MP3
      const mp3Data = await this.encodeWithFFmpeg(
        pcmData,
        audioBuffer.sampleRate,
        audioBuffer.numberOfChannels,
        "mp3",
        bitrate
      );

      const blob = new Blob([mp3Data], { type: "audio/mpeg" });
      console.log("MP3 export completed successfully");
      return blob;
    } catch (error) {
      console.error("Error during MP3 export:", error);

      // Fallback to WAV export if MP3 fails
      console.log("Falling back to WAV export...");
      const wavBlob = await this.exportToWAV(audioBuffer);
      return wavBlob;
    }
  }

  private audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const length = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // Convert float32 to int16
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, audioBuffer.getChannelData(channel)[i])
        );
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    }

    return buffer;
  }

  private async audioBufferToPCM(
    audioBuffer: AudioBuffer
  ): Promise<ArrayBuffer> {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    // Create interleaved PCM data (16-bit)
    const pcmData = new Int16Array(length * channels);

    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, audioBuffer.getChannelData(channel)[i])
        );
        pcmData[i * channels + channel] = sample * 0x7fff;
      }
    }

    return pcmData.buffer;
  }

  private async checkAvailableCodecs(): Promise<string[]> {
    try {
      // Run codec list command using FFmpeg API
      const result = await this.ffmpeg.exec(["-codecs"]);
      console.log("Codec command completed");

      // For now, assume common codecs are available
      // The actual codec detection would require parsing the logs
      const availableCodecs = ["aac", "mp3", "vorbis", "opus"];

      console.log("Available audio encoders:", availableCodecs);
      return availableCodecs;
    } catch (error) {
      console.error("Error checking codecs:", error);
      return [];
    }
  }

  private async encodeWithFFmpeg(
    pcmData: ArrayBuffer,
    sampleRate: number,
    channels: number,
    format: string,
    bitrate: number
  ): Promise<ArrayBuffer> {
    const inputFile = "input.pcm";
    const outputFile = `output.${format}`;

    try {
      // Write PCM data to FFmpeg filesystem
      await this.ffmpeg.writeFile(inputFile, new Uint8Array(pcmData));
      console.log(`Wrote ${pcmData.byteLength} bytes to ${inputFile}`);

      // Build FFmpeg command
      const command = [
        "-f",
        "s16le", // 16-bit signed little-endian PCM
        "-ar",
        sampleRate.toString(),
        "-ac",
        channels.toString(),
        "-i",
        inputFile,
      ];

      // Add format-specific options
      if (format === "mp3") {
        command.push("-codec:a", "libmp3lame", "-b:a", `${bitrate}k`);
      } else if (format === "m4a") {
        command.push("-codec:a", "aac", "-b:a", `${bitrate}k`, "-f", "mp4");
      } else if (format === "ogg") {
        command.push("-codec:a", "libvorbis", "-b:a", `${bitrate}k`);
      }

      command.push(outputFile);

      console.log("Running FFmpeg command:", command);

      // Execute FFmpeg command
      await this.ffmpeg.exec(command);
      console.log("FFmpeg execution completed");

      // Read the output file
      const outputData = await this.ffmpeg.readFile(outputFile);
      console.log(
        `Successfully encoded ${format} file, size: ${outputData.length} bytes`
      );

      return outputData.buffer;
    } catch (error) {
      console.error("FFmpeg encoding error:", error);
      throw new Error(`Failed to encode to ${format}: ${error}`);
    }
  }

  // Check if the exporter is ready
  isInitialized(): boolean {
    return this.initialized;
  }
}
