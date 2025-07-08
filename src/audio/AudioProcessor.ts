export class AudioProcessor {
  private audioContext: AudioContext;

  constructor() {
    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
  }

  async decodeAudioFile(file: File): Promise<AudioBuffer> {
    try {
      const arrayBuffer = await file.arrayBuffer();

      // Try Web Audio API first (works for WAV and MP3)
      try {
        const audioBuffer = await this.audioContext.decodeAudioData(
          arrayBuffer
        );
        console.log("Successfully decoded with Web Audio API");
        return audioBuffer;
      } catch (webAudioError) {
        console.log("Web Audio API failed, trying FFmpeg for M4A...");

        // If Web Audio API fails, try FFmpeg (for M4A files)
        return await this.decodeWithFFmpeg(arrayBuffer, file.name);
      }
    } catch (error) {
      throw new Error(
        `Failed to decode audio file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async decodeWithFFmpeg(
    arrayBuffer: ArrayBuffer,
    filename: string
  ): Promise<AudioBuffer> {
    // Dynamic import to avoid loading FFmpeg unless needed
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile } = await import("@ffmpeg/util");

    const ffmpeg = new FFmpeg();

    // Load FFmpeg with CORS headers for SharedArrayBuffer
    await ffmpeg.load({
      coreURL: await this.getFFmpegCoreURL(),
      wasmURL: await this.getFFmpegWasmURL(),
    });

    try {
      // Write input file
      const inputName = "input" + this.getFileExtension(filename);
      const outputName = "output.wav";

      await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));

      // Convert to WAV using FFmpeg
      await ffmpeg.exec([
        "-i",
        inputName,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-f",
        "wav",
        outputName,
      ]);

      // Read output file
      const outputData = await ffmpeg.readFile(outputName);
      const wavArrayBuffer = (outputData as Uint8Array).buffer;

      // Decode the WAV with Web Audio API
      const audioBuffer = await this.audioContext.decodeAudioData(
        wavArrayBuffer
      );

      console.log("Successfully decoded with FFmpeg");
      return audioBuffer;
    } finally {
      // Clean up FFmpeg instance
      ffmpeg.terminate();
    }
  }

  private async getFFmpegCoreURL(): Promise<string> {
    // Try to load from CDN first, fallback to local
    const cdnUrl =
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";

    try {
      const response = await fetch(cdnUrl, { method: "HEAD" });
      if (response.ok) {
        return cdnUrl;
      }
    } catch (error) {
      console.warn("CDN not available, using local FFmpeg core");
    }

    // Fallback to local file (would need to be bundled)
    return "./ffmpeg-core.js";
  }

  private async getFFmpegWasmURL(): Promise<string> {
    // Try to load from CDN first, fallback to local
    const cdnUrl =
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

    try {
      const response = await fetch(cdnUrl, { method: "HEAD" });
      if (response.ok) {
        return cdnUrl;
      }
    } catch (error) {
      console.warn("CDN not available, using local FFmpeg WASM");
    }

    // Fallback to local file (would need to be bundled)
    return "./ffmpeg-core.wasm";
  }

  private getFileExtension(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
    switch (ext) {
      case "mp3":
        return ".mp3";
      case "m4a":
        return ".m4a";
      case "wav":
        return ".wav";
      default:
        return ".wav";
    }
  }

  // Helper method to convert AudioBuffer to different formats
  audioBufferToFloat32Array(audioBuffer: AudioBuffer): Float32Array[] {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const result: Float32Array[] = [];

    for (let i = 0; i < channels; i++) {
      result.push(audioBuffer.getChannelData(i));
    }

    return result;
  }

  // Helper method to create AudioBuffer from Float32Array data
  createAudioBuffer(
    channelData: Float32Array[],
    sampleRate: number
  ): AudioBuffer {
    const channels = channelData.length;
    const length = channelData[0].length;

    const audioBuffer = this.audioContext.createBuffer(
      channels,
      length,
      sampleRate
    );

    for (let i = 0; i < channels; i++) {
      audioBuffer.copyToChannel(channelData[i], i);
    }

    return audioBuffer;
  }

  // Get the current AudioContext
  getAudioContext(): AudioContext {
    return this.audioContext;
  }
}

