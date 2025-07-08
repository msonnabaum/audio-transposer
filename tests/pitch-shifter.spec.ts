import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Pitch Shifter', () => {
  test('should shift middle C up 6 semitones to G and preserve duration', async ({ page }) => {
    // Get the absolute path to the HTML file and test audio
    const htmlPath = path.resolve(__dirname, '../dist/index.html');
    const audioPath = path.resolve(__dirname, 'middle-c.mp3');
    
    console.log('HTML path:', htmlPath);
    console.log('Audio path:', audioPath);
    
    // Navigate to the HTML file
    await page.goto(`file://${htmlPath}`);
    
    // Wait for the page to load completely
    await page.waitForLoadState('networkidle');
    
    // Add console logging to capture debug info
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleMessages.push(text);
      console.log(`Browser console: ${text}`);
    });
    
    // Capture any errors
    const errors: string[] = [];
    page.on('pageerror', error => {
      const message = error.message;
      errors.push(message);
      console.error(`Browser error: ${message}`);
    });
    
    // Wait for the app to initialize
    await page.waitForSelector('#dropZone', { timeout: 10000 });
    
    // Check if the app is ready
    const statusText = await page.textContent('#status');
    console.log('Initial status:', statusText);
    
    // Upload the middle-c.mp3 file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(audioPath);
    
    // Wait for the file to be processed (look for status change)
    await page.waitForFunction(() => {
      const status = document.querySelector('#status');
      return status && status.textContent !== 'Ready to load audio file';
    }, { timeout: 30000 });
    
    // Wait for controls to become visible
    await page.waitForSelector('#controls.visible', { timeout: 15000 });
    
    // Get original audio duration
    const originalAudio = page.locator('#originalAudio');
    await originalAudio.waitFor({ state: 'visible' });
    
    // Wait for audio metadata to load
    await page.waitForFunction(() => {
      const audio = document.querySelector('#originalAudio') as HTMLAudioElement;
      return audio && audio.duration > 0;
    }, { timeout: 10000 });
    
    const originalDuration = await page.evaluate(() => {
      const audio = document.querySelector('#originalAudio') as HTMLAudioElement;
      return audio.duration;
    });
    
    console.log('Original duration:', originalDuration);
    
    // Set the pitch slider to +6 semitones (middle C to G)
    const pitchSlider = page.locator('#pitchSlider');
    await pitchSlider.fill('6');
    
    // Verify slider value is displayed correctly
    const sliderValue = await page.textContent('#sliderValue');
    expect(sliderValue).toBe('6');
    
    // Click preview button to process the audio
    const previewBtn = page.locator('#previewBtn');
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();
    
    // Wait for processing to complete
    await page.waitForFunction(() => {
      const btn = document.querySelector('#previewBtn') as HTMLButtonElement;
      return btn && btn.textContent === 'Preview' && !btn.disabled;
    }, { timeout: 30000 });
    
    // Wait for processed audio to appear
    await page.waitForSelector('#processedAudio[style*="block"]', { timeout: 10000 });
    
    // Wait for processed audio metadata to load
    await page.waitForFunction(() => {
      const audio = document.querySelector('#processedAudio') as HTMLAudioElement;
      return audio && audio.duration > 0;
    }, { timeout: 10000 });
    
    // Get processed audio duration
    const processedDuration = await page.evaluate(() => {
      const audio = document.querySelector('#processedAudio') as HTMLAudioElement;
      return audio.duration;
    });
    
    console.log('Processed duration:', processedDuration);
    
    // Verify duration is preserved (within 1% tolerance)
    const durationDiff = Math.abs(originalDuration - processedDuration);
    const tolerance = originalDuration * 0.01; // 1% tolerance
    expect(durationDiff).toBeLessThan(tolerance);
    
    // Test pitch analysis using Web Audio API
    const pitchAnalysis = await page.evaluate(async () => {
      const processedAudio = document.querySelector('#processedAudio') as HTMLAudioElement;
      
      // Create AudioContext for analysis
      const audioContext = new AudioContext();
      
      // Fetch the audio data
      const response = await fetch(processedAudio.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Simple pitch detection using FFT
      const sampleRate = audioBuffer.sampleRate;
      const channelData = audioBuffer.getChannelData(0);
      
      // Find the dominant frequency using autocorrelation
      const findPitch = (buffer: Float32Array, sampleRate: number) => {
        const bufferSize = 1024;
        const start = Math.floor(buffer.length / 4); // Start from middle
        const analysisBuffer = buffer.slice(start, start + bufferSize);
        
        let bestCorrelation = -1;
        let bestPeriod = 0;
        
        const minPeriod = Math.floor(sampleRate / 800); // ~800Hz max
        const maxPeriod = Math.floor(sampleRate / 80);  // ~80Hz min
        
        for (let period = minPeriod; period < maxPeriod; period++) {
          let correlation = 0;
          for (let i = 0; i < bufferSize - period; i++) {
            correlation += Math.abs(analysisBuffer[i] - analysisBuffer[i + period]);
          }
          correlation = 1 - (correlation / bufferSize);
          
          if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestPeriod = period;
          }
        }
        
        return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
      };
      
      const frequency = findPitch(channelData, sampleRate);
      
      // Convert frequency to note
      const getNote = (freq: number) => {
        const A4 = 440;
        const C4 = A4 * Math.pow(2, -9/12); // C4 is 9 semitones below A4
        const semitoneRatio = Math.pow(2, 1/12);
        
        const semitonesFromC4 = Math.round(Math.log(freq / C4) / Math.log(semitoneRatio));
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const noteIndex = ((semitonesFromC4 % 12) + 12) % 12;
        const octave = Math.floor(semitonesFromC4 / 12) + 4;
        
        return {
          note: notes[noteIndex],
          octave: octave,
          frequency: freq,
          semitonesFromC4: semitonesFromC4
        };
      };
      
      return getNote(frequency);
    });
    
    console.log('Pitch analysis result:', pitchAnalysis);
    
    // Verify the pitch was shifted correctly
    // Middle C (C4) + 6 semitones = G4
    expect(pitchAnalysis.note).toBe('G');
    
    // Verify semitones shift (should be around 6 from original C)
    expect(pitchAnalysis.semitonesFromC4).toBeGreaterThanOrEqual(5);
    expect(pitchAnalysis.semitonesFromC4).toBeLessThanOrEqual(7);
    
    // Check for any console errors that might indicate NaN issues
    const nanErrors = consoleMessages.filter(msg => 
      msg.includes('NaN') || msg.includes('Inf') || msg.includes('nan')
    );
    
    if (nanErrors.length > 0) {
      console.error('Found NaN/Inf errors in console:', nanErrors);
    }
    
    // Log all console messages for debugging
    console.log('All console messages:', consoleMessages);
    
    // Verify no critical errors occurred
    expect(errors.length).toBe(0);
    
    // The test passes if we get here without errors
    console.log('Test completed successfully!');
  });
});