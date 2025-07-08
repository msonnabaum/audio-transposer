declare module "@echogarden/rubberband-wasm" {
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
      process(
        inputChannels: Float32Array[],
        isLastChunk: boolean
      ): Float32Array[];
    };
  }

  export interface RubberBandModule {
    cwrap(funcName: string, returnType: string, argTypes: string[]): Function;
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
  }

  export function createRubberBandStretcher(): Promise<RubberBandStretcher>;

  const RubberBandModuleFactory: (options?: any) => Promise<RubberBandModule>;
  export default RubberBandModuleFactory;
}

