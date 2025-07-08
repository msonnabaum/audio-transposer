export class UIController {
  private dropZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private controls: HTMLElement;
  private pitchSlider: HTMLInputElement;
  private sliderValue: HTMLElement;
  private previewBtn: HTMLButtonElement;
  private exportBtn: HTMLButtonElement;
  private originalAudio: HTMLAudioElement;
  private processedAudio: HTMLAudioElement;
  private status: HTMLElement;
  private progressBar: HTMLElement;
  private progressFill: HTMLElement;
  
  private currentAudioBuffer: AudioBuffer | null = null;
  private processedAudioBuffer: AudioBuffer | null = null;
  private onFileUpload: ((file: File) => void) | null = null;
  private onPitchShift: ((buffer: AudioBuffer, semitones: number) => void) | null = null;
  private onExport: ((buffer: AudioBuffer) => void) | null = null;

  constructor() {
    this.dropZone = document.getElementById('dropZone')!;
    this.fileInput = document.getElementById('fileInput') as HTMLInputElement;
    this.controls = document.getElementById('controls')!;
    this.pitchSlider = document.getElementById('pitchSlider') as HTMLInputElement;
    this.sliderValue = document.getElementById('sliderValue')!;
    this.previewBtn = document.getElementById('previewBtn') as HTMLButtonElement;
    this.exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    this.originalAudio = document.getElementById('originalAudio') as HTMLAudioElement;
    this.processedAudio = document.getElementById('processedAudio') as HTMLAudioElement;
    this.status = document.getElementById('status')!;
    this.progressBar = document.getElementById('progressBar')!;
    this.progressFill = document.getElementById('progressFill')!;
  }

  init(onFileUpload: (file: File) => void) {
    this.onFileUpload = onFileUpload;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Prevent default drag behaviors on document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // Drag and drop events
    this.dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
    this.dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
    this.dropZone.addEventListener('drop', this.handleDrop.bind(this));
    this.dropZone.addEventListener('click', () => this.fileInput.click());

    // File input change
    this.fileInput.addEventListener('change', this.handleFileInputChange.bind(this));

    // Pitch slider
    this.pitchSlider.addEventListener('input', this.handleSliderChange.bind(this));

    // Buttons
    this.previewBtn.addEventListener('click', this.handlePreview.bind(this));
    this.exportBtn.addEventListener('click', this.handleExport.bind(this));
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone.classList.add('dragover');
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone.classList.remove('dragover');
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFile(files[0]);
    }
  }

  private handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      this.processFile(files[0]);
    }
  }

  private processFile(file: File) {
    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'];
    const allowedExtensions = ['.mp3', '.wav', '.m4a'];
    
    const isValidType = allowedTypes.includes(file.type);
    const isValidExtension = allowedExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );

    if (!isValidType && !isValidExtension) {
      this.setStatus('Error: Please select an MP3, WAV, or M4A file', 'error');
      return;
    }

    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      this.setStatus('Error: File size must be less than 50MB', 'error');
      return;
    }

    if (this.onFileUpload) {
      this.onFileUpload(file);
    }
  }

  private handleSliderChange() {
    const value = parseInt(this.pitchSlider.value, 10);
    this.sliderValue.textContent = value.toString();
    
    // Reset processed audio when slider changes
    this.processedAudio.style.display = 'none';
    this.processedAudio.src = '';
    this.exportBtn.disabled = true;
  }

  private handlePreview() {
    if (!this.currentAudioBuffer || !this.onPitchShift) return;
    
    const semitones = parseInt(this.pitchSlider.value, 10);
    console.log(`UI: Slider value: "${this.pitchSlider.value}", parsed semitones: ${semitones}`);
    
    // Validate semitones value
    if (!isFinite(semitones)) {
      this.setStatus('Error: Invalid pitch value', 'error');
      return;
    }
    
    // Show loading indicators
    this.previewBtn.disabled = true;
    this.previewBtn.classList.add('loading');
    this.previewBtn.textContent = 'Processing...';
    this.showProgress();
    this.setStatus('Processing audio... This may take a moment.', 'processing');
    
    this.onPitchShift(this.currentAudioBuffer, semitones);
  }

  private handleExport() {
    if (!this.processedAudioBuffer || !this.onExport) return;
    
    // Show loading indicators
    this.exportBtn.disabled = true;
    this.exportBtn.classList.add('loading');
    this.exportBtn.textContent = 'Exporting...';
    this.showProgress();
    this.setStatus('Exporting audio file... Please wait.', 'processing');
    
    this.onExport(this.processedAudioBuffer);
  }

  enableControls(audioBuffer: AudioBuffer, onPitchShift: (buffer: AudioBuffer, semitones: number) => void) {
    this.currentAudioBuffer = audioBuffer;
    this.onPitchShift = onPitchShift;
    
    this.controls.classList.add('visible');
    this.previewBtn.disabled = false;
    
    // Create and display original audio
    this.createAudioFromBuffer(audioBuffer).then(audioUrl => {
      this.originalAudio.src = audioUrl;
      this.originalAudio.style.display = 'block';
    });
  }

  setProcessedAudio(audioBuffer: AudioBuffer) {
    this.processedAudioBuffer = audioBuffer;
    
    // Reset preview button loading state
    this.previewBtn.disabled = false;
    this.previewBtn.classList.remove('loading');
    this.previewBtn.textContent = 'Preview';
    this.hideProgress();
    this.setStatus('Audio processed successfully', 'success');
    
    // Create and display processed audio
    this.createAudioFromBuffer(audioBuffer).then(audioUrl => {
      this.processedAudio.src = audioUrl;
      this.processedAudio.style.display = 'block';
    });
  }

  enableExport(onExport: (buffer: AudioBuffer) => void) {
    this.onExport = onExport;
    this.exportBtn.disabled = false;
  }

  setStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
    this.status.textContent = message;
    this.status.className = `status ${type}`;
  }

  downloadFile(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Reset export button loading state
    this.exportBtn.disabled = false;
    this.exportBtn.classList.remove('loading');
    this.exportBtn.textContent = 'Export M4A';
    this.hideProgress();
    this.setStatus('Audio exported successfully', 'success');
  }

  private showProgress() {
    this.progressBar.classList.add('visible');
    this.progressFill.classList.add('indeterminate');
  }

  private hideProgress() {
    this.progressBar.classList.remove('visible');
    this.progressFill.classList.remove('indeterminate');
    this.progressFill.style.width = '0%';
  }

  resetLoadingStates() {
    // Reset preview button
    this.previewBtn.disabled = false;
    this.previewBtn.classList.remove('loading');
    this.previewBtn.textContent = 'Preview';
    
    // Reset export button
    this.exportBtn.disabled = false;
    this.exportBtn.classList.remove('loading');
    this.exportBtn.textContent = 'Export M4A';
    
    // Hide progress
    this.hideProgress();
  }

  private async createAudioFromBuffer(audioBuffer: AudioBuffer): Promise<string> {
    // Convert AudioBuffer to WAV for playback
    const wavArrayBuffer = this.audioBufferToWav(audioBuffer);
    const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
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
}