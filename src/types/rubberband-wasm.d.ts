declare module '@echogarden/rubberband-wasm' {
  export interface RubberBandStretcherOptions {
    pitchScale?: number;
    timeRatio?: number;
    formantPreserved?: boolean;
    highQuality?: boolean;
  }

  export interface RubberBandStretcher {
    createStretcher(
      sampleRate: number,
      channels: number,
      options?: RubberBandStretcherOptions
    ): {
      process(inputChannels: Float32Array[], isLastChunk: boolean): Float32Array[];
    };
  }

  export function createRubberBandStretcher(): Promise<RubberBandStretcher>;
}