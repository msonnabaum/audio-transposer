export class AudioExporter {
  private initialized = false;

  async init() {
    if (this.initialized) return;

    try {
      // Simple initialization - no FFmpeg needed
      console.log('Audio exporter initialized (using Web Audio API)');
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize audio exporter:', error);
      throw new Error(`Failed to initialize audio exporter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exportToM4A(audioBuffer: AudioBuffer, bitrate: number = 256): Promise<Blob> {
    if (!this.initialized) {
      throw new Error('Audio exporter not initialized');
    }

    try {
      console.log(`Exporting to M4A using Media Recorder API...`);
      
      // Create a MediaStream from the AudioBuffer
      const mediaStream = await this.audioBufferToMediaStream(audioBuffer);
      
      // Use MediaRecorder to encode to M4A/AAC
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'audio/mp4; codecs="mp4a.40.2"' // AAC codec
      });
      
      const chunks: Blob[] = [];
      
      return new Promise((resolve, reject) => {
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/mp4' });
          console.log('M4A export completed successfully');
          resolve(blob);
        };
        
        mediaRecorder.onerror = (error) => {
          console.error('MediaRecorder error:', error);
          reject(new Error('M4A export failed'));
        };
        
        mediaRecorder.start();
        
        // Stop recording after the audio duration
        setTimeout(() => {
          mediaRecorder.stop();
          mediaStream.getTracks().forEach(track => track.stop());
        }, (audioBuffer.duration + 0.1) * 1000); // Add small buffer
      });
      
    } catch (error) {
      console.error('Error during M4A export:', error);
      
      // Fallback to WAV export if M4A fails
      console.log('Falling back to WAV export...');
      const wavBlob = await this.exportToWAV(audioBuffer);
      return wavBlob;
    }
  }

  async exportToWAV(audioBuffer: AudioBuffer): Promise<Blob> {
    if (!this.initialized) {
      throw new Error('Audio exporter not initialized');
    }

    try {
      console.log('Exporting to WAV...');
      
      // Convert AudioBuffer to WAV ArrayBuffer
      const wavArrayBuffer = this.audioBufferToWav(audioBuffer);
      
      console.log('WAV export completed successfully');
      return new Blob([wavArrayBuffer], { type: 'audio/wav' });
      
    } catch (error) {
      console.error('Error during WAV export:', error);
      throw new Error(`WAV export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exportToMP3(audioBuffer: AudioBuffer, bitrate: number = 256): Promise<Blob> {
    if (!this.initialized) {
      throw new Error('Audio exporter not initialized');
    }

    try {
      console.log(`Exporting to MP3 using Media Recorder API...`);
      
      // Create a MediaStream from the AudioBuffer
      const mediaStream = await this.audioBufferToMediaStream(audioBuffer);
      
      // Use MediaRecorder to encode to MP3 if supported
      let mimeType = 'audio/mpeg';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        // Fallback to WebM audio if MP3 not supported
        mimeType = 'audio/webm';
      }
      
      const mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
      const chunks: Blob[] = [];
      
      return new Promise((resolve, reject) => {
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          console.log('MP3 export completed successfully');
          resolve(blob);
        };
        
        mediaRecorder.onerror = (error) => {
          console.error('MediaRecorder error:', error);
          reject(new Error('MP3 export failed'));
        };
        
        mediaRecorder.start();
        
        // Stop recording after the audio duration
        setTimeout(() => {
          mediaRecorder.stop();
          mediaStream.getTracks().forEach(track => track.stop());
        }, (audioBuffer.duration + 0.1) * 1000); // Add small buffer
      });
      
    } catch (error) {
      console.error('Error during MP3 export:', error);
      
      // Fallback to WAV export if MP3 fails
      console.log('Falling back to WAV export...');
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
    
    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Convert float32 to int16
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return buffer;
  }

  private async audioBufferToMediaStream(audioBuffer: AudioBuffer): Promise<MediaStream> {
    // Create an AudioContext and source
    const audioContext = new AudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Create a MediaStreamDestination
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    
    // Start playing the audio
    source.start();
    
    return destination.stream;
  }

  // Check if the exporter is ready
  isInitialized(): boolean {
    return this.initialized;
  }
}