import { Page } from "@playwright/test";

export interface PitchAnalysisResult {
  note: string;
  octave: number;
  frequency: number;
  semitonesFromC4: number;
}

export async function analyzePitch(page: Page, audioSelector: string): Promise<PitchAnalysisResult> {
  return await page.evaluate(async (selector) => {
    const audioElement = document.querySelector(selector) as HTMLAudioElement;
    if (!audioElement) {
      throw new Error(`Audio element not found: ${selector}`);
    }

    const audioContext = new AudioContext();

    const response = await fetch(audioElement.src);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    const findPitch = (buffer: Float32Array, sampleRate: number) => {
      const bufferSize = 1024;
      const start = Math.floor(buffer.length / 4);
      const analysisBuffer = buffer.slice(start, start + bufferSize);

      let bestCorrelation = -1;
      let bestPeriod = 0;

      const minPeriod = Math.floor(sampleRate / 800);
      const maxPeriod = Math.floor(sampleRate / 80);

      for (let period = minPeriod; period < maxPeriod; period++) {
        let correlation = 0;
        for (let i = 0; i < bufferSize - period; i++) {
          correlation += Math.abs(
            analysisBuffer[i] - analysisBuffer[i + period]
          );
        }
        correlation = 1 - correlation / bufferSize;

        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestPeriod = period;
        }
      }

      return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
    };

    const frequency = findPitch(channelData, sampleRate);

    const getNote = (freq: number) => {
      const A4 = 440;
      const C4 = A4 * Math.pow(2, -9 / 12);
      const semitoneRatio = Math.pow(2, 1 / 12);

      const semitonesFromC4 = Math.round(
        Math.log(freq / C4) / Math.log(semitoneRatio)
      );
      const notes = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
      ];
      const noteIndex = ((semitonesFromC4 % 12) + 12) % 12;
      const octave = Math.floor(semitonesFromC4 / 12) + 4;

      return {
        note: notes[noteIndex],
        octave: octave,
        frequency: freq,
        semitonesFromC4: semitonesFromC4,
      };
    };

    return getNote(frequency);
  }, audioSelector);
}