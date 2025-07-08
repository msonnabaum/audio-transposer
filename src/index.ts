import { AudioProcessor } from './audio/AudioProcessor';
import { PitchShifter } from './audio/PitchShifter';
import { AudioExporter } from './audio/AudioExporter';
import { UIController } from './ui/UIController';

class PitchShifterApp {
  private audioProcessor: AudioProcessor;
  private pitchShifter: PitchShifter;
  private audioExporter: AudioExporter;
  private uiController: UIController;

  constructor() {
    this.audioProcessor = new AudioProcessor();
    this.pitchShifter = new PitchShifter();
    this.audioExporter = new AudioExporter();
    this.uiController = new UIController();
  }

  async init() {
    await this.pitchShifter.init();
    await this.audioExporter.init();
    this.uiController.init(this.handleFileUpload.bind(this));
    console.log('Pitch Shifter Web App initialized');
  }

  private async handleFileUpload(file: File) {
    try {
      this.uiController.setStatus('Loading audio file...');
      
      const audioBuffer = await this.audioProcessor.decodeAudioFile(file);
      this.uiController.setStatus('Audio file loaded successfully');
      
      this.uiController.enableControls(audioBuffer, this.handlePitchShift.bind(this));
    } catch (error) {
      console.error('Error processing audio file:', error);
      this.uiController.setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handlePitchShift(audioBuffer: AudioBuffer, semitones: number) {
    try {
      const processedBuffer = await this.pitchShifter.shiftPitch(
        audioBuffer, 
        semitones,
        (progress: number) => {
          this.uiController.updateProgress(progress);
        }
      );
      this.uiController.setProcessedAudio(processedBuffer);
      this.uiController.enableExport(this.handleExport.bind(this));
    } catch (error) {
      console.error('Error pitch shifting:', error);
      this.uiController.resetLoadingStates();
      this.uiController.setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private async handleExport(audioBuffer: AudioBuffer) {
    try {
      const m4aBlob = await this.audioExporter.exportToM4A(audioBuffer);
      this.uiController.downloadFile(m4aBlob, 'pitch-shifted-audio.m4a');
    } catch (error) {
      console.error('Error exporting audio:', error);
      this.uiController.resetLoadingStates();
      this.uiController.setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const app = new PitchShifterApp();
  await app.init();
});