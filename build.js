const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const isDev = process.argv.includes("--dev");

// Plugin to embed WASM files as Uint8Array
const wasmEmbedPlugin = {
  name: "wasm-embed",
  setup(build) {
    // Handle rubberband-wasm module
    build.onResolve({ filter: /^@echogarden\/rubberband-wasm$/ }, (args) => {
      return { path: args.path, namespace: "wasm-embed" };
    });

    build.onLoad({ filter: /.*/, namespace: "wasm-embed" }, () => {
      const wasmPath = path.join(
        __dirname,
        "node_modules/@echogarden/rubberband-wasm/rubberband.wasm"
      );
      const jsPath = path.join(
        __dirname,
        "node_modules/@echogarden/rubberband-wasm/rubberband.js"
      );

      const wasmData = fs.readFileSync(wasmPath);
      const jsCode = fs.readFileSync(jsPath, "utf8");

      // Convert WASM to base64 for embedding
      const wasmBase64 = wasmData.toString("base64");

      return {
        contents: `
          // Embedded WASM data as base64
          const wasmBase64 = "${wasmBase64}";
          const wasmBinary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));

          // Load the rubberband.js code and modify its exports
          ${jsCode.replace(
            "export default Rubberband;",
            "// export default Rubberband;"
          )}

          // Override the default export to use our embedded WASM
          export default function(moduleArg = {}) {
            moduleArg.wasmBinary = wasmBinary;

            // Prevent the module from trying to load WASM from URL
            moduleArg.locateFile = (path) => {
              if (path.endsWith('.wasm')) {
                return 'data:application/wasm;base64,' + wasmBase64;
              }
              return path;
            };

            return Rubberband(moduleArg);
          }
        `,
        loader: "js",
      };
    });
  },
};

// Plugin to embed FFmpeg core files for @ffmpeg/ffmpeg
const ffmpegEmbedPlugin = {
  name: "ffmpeg-embed",
  setup(build) {
    // Handle @ffmpeg/ffmpeg module imports - provide a custom FFmpeg class with embedded worker
    build.onResolve({ filter: /^@ffmpeg\/ffmpeg$/ }, (args) => {
      return { path: args.path, namespace: "ffmpeg-embed" };
    });

    build.onLoad({ filter: /.*/, namespace: "ffmpeg-embed" }, () => {
      const ffmpegJsPath = path.join(
        __dirname,
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"
      );
      const ffmpegWasmPath = path.join(
        __dirname,
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
      );

      const ffmpegJs = fs.readFileSync(ffmpegJsPath, "utf8");
      const ffmpegWasm = fs.readFileSync(ffmpegWasmPath);
      const wasmBase64 = ffmpegWasm.toString("base64");

      const coreJsBase64 = Buffer.from(ffmpegJs).toString("base64");

      return {
        contents: `
          // Embedded FFmpeg with core and worker
          const wasmBase64 = "${wasmBase64}";
          const coreJsBase64 = "${coreJsBase64}";

          // Create embedded worker code that works with the core
          const createEmbeddedWorkerCode = () => {
            return \`
              // Constants for FFmpeg message types
              const FFMessageType = {
                LOAD: "LOAD",
                EXEC: "EXEC",
                FFPROBE: "FFPROBE", 
                WRITE_FILE: "WRITE_FILE",
                READ_FILE: "READ_FILE",
                DELETE_FILE: "DELETE_FILE",
                RENAME: "RENAME",
                CREATE_DIR: "CREATE_DIR",
                LIST_DIR: "LIST_DIR",
                DELETE_DIR: "DELETE_DIR",
                ERROR: "ERROR",
                DOWNLOAD: "DOWNLOAD",
                PROGRESS: "PROGRESS",
                LOG: "LOG",
                MOUNT: "MOUNT",
                UNMOUNT: "UNMOUNT"
              };

              const ERROR_UNKNOWN_MESSAGE_TYPE = "unknown message type";
              const ERROR_NOT_LOADED = "ffmpeg is not loaded";
              const ERROR_IMPORT_FAILURE = "failed to import ffmpeg-core.js";

              let ffmpeg;

              const load = async ({ coreURL, wasmURL, workerURL }) => {
                const first = !ffmpeg;
                try {
                  // Decode and execute the core module using eval in worker context
                  const coreJs = atob("${coreJsBase64}");
                  
                  // Create a module object for the core to populate
                  const module = { exports: {} };
                  
                  // Execute the core JavaScript with proper module context
                  const wrappedCode = '(function(module, exports) {' + coreJs + '})(module, module.exports);';
                  
                  eval(wrappedCode);
                  
                  // The core should have set module.exports to the createFFmpegCore function
                  self.createFFmpegCore = module.exports;
                  
                  if (!self.createFFmpegCore || typeof self.createFFmpegCore !== 'function') {
                    throw new Error(ERROR_IMPORT_FAILURE);
                  }
                } catch (error) {
                  console.error('Failed to create core:', error);
                  throw error;
                }

                // Create ffmpeg instance with embedded WASM
                ffmpeg = await self.createFFmpegCore({
                  wasmBinary: Uint8Array.from(atob("${wasmBase64}"), c => c.charCodeAt(0)),
                  locateFile: (path) => {
                    if (path.endsWith('.wasm')) {
                      return 'data:application/wasm;base64,' + "${wasmBase64}";
                    }
                    return path;
                  }
                });

                ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
                ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));
                return first;
              };

              const exec = ({ args, timeout = -1 }) => {
                ffmpeg.setTimeout(timeout);
                ffmpeg.exec(...args);
                const ret = ffmpeg.ret;
                ffmpeg.reset();
                return ret;
              };

              const writeFile = ({ path, data }) => {
                ffmpeg.FS.writeFile(path, data);
                return true;
              };

              const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });

              const deleteFile = ({ path }) => {
                ffmpeg.FS.unlink(path);
                return true;
              };

              self.onmessage = async ({ data: { id, type, data: _data } }) => {
                const trans = [];
                let data;
                try {
                  if (type !== FFMessageType.LOAD && !ffmpeg) {
                    throw new Error(ERROR_NOT_LOADED);
                  }
                  switch (type) {
                    case FFMessageType.LOAD:
                      data = await load(_data);
                      break;
                    case FFMessageType.EXEC:
                      data = exec(_data);
                      break;
                    case FFMessageType.WRITE_FILE:
                      data = writeFile(_data);
                      break;
                    case FFMessageType.READ_FILE:
                      data = readFile(_data);
                      break;
                    case FFMessageType.DELETE_FILE:
                      data = deleteFile(_data);
                      break;
                    default:
                      throw new Error(ERROR_UNKNOWN_MESSAGE_TYPE);
                  }
                } catch (e) {
                  self.postMessage({
                    id,
                    type: FFMessageType.ERROR,
                    data: e.toString(),
                  });
                  return;
                }
                if (data instanceof Uint8Array) {
                  trans.push(data.buffer);
                }
                self.postMessage({ id, type, data }, trans);
              };
            \`;
          };

          // Custom FFmpeg class that uses embedded worker
          class FFmpeg {
            #worker = null;
            #resolves = {};
            #rejects = {};
            #logEventCallbacks = [];
            #progressEventCallbacks = [];
            loaded = false;

            #registerHandlers = () => {
              if (this.#worker) {
                this.#worker.onmessage = ({ data: { id, type, data } }) => {
                  const FFMessageType = {
                    LOAD: "LOAD",
                    EXEC: "EXEC",
                    WRITE_FILE: "WRITE_FILE",
                    READ_FILE: "READ_FILE",
                    DELETE_FILE: "DELETE_FILE",
                    ERROR: "ERROR",
                    LOG: "LOG",
                    PROGRESS: "PROGRESS"
                  };
                  
                  switch (type) {
                    case FFMessageType.LOAD:
                      this.loaded = true;
                      this.#resolves[id](data);
                      break;
                    case FFMessageType.EXEC:
                    case FFMessageType.WRITE_FILE:
                    case FFMessageType.READ_FILE:
                    case FFMessageType.DELETE_FILE:
                      this.#resolves[id](data);
                      break;
                    case FFMessageType.LOG:
                      this.#logEventCallbacks.forEach((f) => f(data));
                      break;
                    case FFMessageType.PROGRESS:
                      this.#progressEventCallbacks.forEach((f) => f(data));
                      break;
                    case FFMessageType.ERROR:
                      this.#rejects[id](data);
                      break;
                  }
                  delete this.#resolves[id];
                  delete this.#rejects[id];
                };
              }
            };

            #send = ({ type, data }, trans = [], signal) => {
              if (!this.#worker) {
                return Promise.reject(new Error("ffmpeg is not loaded"));
              }
              return new Promise((resolve, reject) => {
                const id = Date.now() + Math.random();
                this.#worker.postMessage({ id, type, data }, trans);
                this.#resolves[id] = resolve;
                this.#rejects[id] = reject;
                signal?.addEventListener("abort", () => {
                  reject(new DOMException(\`Message # \${id} was aborted\`, "AbortError"));
                }, { once: true });
              });
            };

            on(event, callback) {
              if (event === "log") {
                this.#logEventCallbacks.push(callback);
              } else if (event === "progress") {
                this.#progressEventCallbacks.push(callback);
              }
            }

            load = (config = {}, { signal } = {}) => {
              if (!this.#worker) {
                const workerCode = createEmbeddedWorkerCode();
                const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(workerBlob);
                this.#worker = new Worker(workerUrl);
                this.#registerHandlers();
              }
              
              return this.#send({
                type: "LOAD",
                data: config,
              }, undefined, signal);
            };

            exec = (args, timeout = -1, { signal } = {}) => this.#send({
              type: "EXEC",
              data: { args, timeout },
            }, undefined, signal);

            writeFile = (path, data, { signal } = {}) => {
              const trans = [];
              if (data instanceof Uint8Array) {
                trans.push(data.buffer);
              }
              return this.#send({
                type: "WRITE_FILE",
                data: { path, data },
              }, trans, signal);
            };

            readFile = (path, encoding = "binary", { signal } = {}) => this.#send({
              type: "READ_FILE",
              data: { path, encoding },
            }, undefined, signal);

            terminate = () => {
              const ids = Object.keys(this.#rejects);
              for (const id of ids) {
                this.#rejects[id](new Error("terminated"));
                delete this.#rejects[id];
                delete this.#resolves[id];
              }
              if (this.#worker) {
                this.#worker.terminate();
                this.#worker = null;
                this.loaded = false;
              }
            };
          }

          // Export the embedded FFmpeg class
          export { FFmpeg };
        `,
        loader: "js",
      };
    });
  },
};

async function build() {
  try {
    // Ensure dist directory exists
    const distDir = path.join(__dirname, "dist");
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    // Build configuration for normal web app
    const buildConfig = {
      entryPoints: ["src/index.ts"],
      bundle: true,
      minify: !isDev,
      sourcemap: isDev,
      outdir: "dist",
      format: "esm",
      target: "es2022",
      platform: "browser",
      define: {
        "process.env.NODE_ENV": isDev ? '"development"' : '"production"',
        global: "globalThis",
      },
      external: [],
      plugins: [
        wasmEmbedPlugin,
        ffmpegEmbedPlugin,
        // Plugin to handle Node.js modules
        {
          name: "node-modules",
          setup(build) {
            build.onResolve({ filter: /^module$/ }, (args) => {
              return { path: args.path, namespace: "node-stub" };
            });

            build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => {
              return {
                contents: `
                  export const createRequire = () => {
                    throw new Error('require is not supported in browser environment');
                  };
                  export default { createRequire };
                `,
                loader: "js",
              };
            });
          },
        },
      ],
    };

    // Build configuration for web worker
    const workerConfig = {
      entryPoints: ["src/audio/pitch-shifter.worker.ts"],
      bundle: true,
      minify: !isDev,
      sourcemap: isDev,
      outdir: "dist",
      format: "esm",
      target: "es2022",
      platform: "browser",
      define: {
        "process.env.NODE_ENV": isDev ? '"development"' : '"production"',
        global: "globalThis",
      },
      external: [],
      plugins: [
        wasmEmbedPlugin,
        ffmpegEmbedPlugin,
        // Plugin to handle Node.js modules
        {
          name: "node-modules",
          setup(build) {
            build.onResolve({ filter: /^module$/ }, (args) => {
              return { path: args.path, namespace: "node-stub" };
            });

            build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => {
              return {
                contents: `
                  export const createRequire = () => {
                    throw new Error('require is not supported in browser environment');
                  };
                  export default { createRequire };
                `,
                loader: "js",
              };
            });
          },
        },
      ],
    };

    console.log("Building JavaScript bundle...");
    const result = await esbuild.build(buildConfig);

    if (result.errors.length > 0) {
      console.error("Build errors:", result.errors);
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.warn("Build warnings:", result.warnings);
    }

    console.log("Building web worker...");
    const workerResult = await esbuild.build(workerConfig);

    if (workerResult.errors.length > 0) {
      console.error("Worker build errors:", workerResult.errors);
      process.exit(1);
    }

    if (workerResult.warnings.length > 0) {
      console.warn("Worker build warnings:", workerResult.warnings);
    }

    // Read the generated JavaScript file
    const jsFilePath = path.join(distDir, "index.js");
    const jsContent = fs.readFileSync(jsFilePath, "utf8");

    // Read the generated web worker file
    const workerFilePath = path.join(distDir, "pitch-shifter.worker.js");
    const workerContent = fs.readFileSync(workerFilePath, "utf8");

    // Create the HTML template with embedded JavaScript
    const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pitch Shifter Web</title>
    <style>
        ${getCSSContent()}
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 Pitch Shifter</h1>

        <div class="drop-zone" id="dropZone">
            <p>Drop your audio file here</p>
            <small>Supports MP3, M4A, and WAV files</small>
            <input type="file" id="fileInput" accept=".mp3,.m4a,.wav" style="display: none;">
        </div>

        <div class="controls" id="controls">
            <div class="slider-container">
                <label for="pitchSlider">Pitch Shift (semitones):</label>
                <div class="slider-value" id="sliderValue">0</div>
                <input type="range" id="pitchSlider" class="slider" min="-12" max="12" value="0" step="1">
            </div>

            <div class="button-group">
                <button class="btn btn-primary" id="previewBtn" disabled>Preview</button>
                <button class="btn btn-secondary" id="exportBtn" disabled>Export M4A</button>
            </div>

            <div class="audio-player" id="audioPlayer">
                <div>Original:</div>
                <audio id="originalAudio" controls style="display: none;"></audio>
                <div>Processed:</div>
                <audio id="processedAudio" controls style="display: none;"></audio>
            </div>
        </div>

        <div class="status" id="status">Ready to load audio file</div>

        <div class="progress-bar" id="progressBar">
            <div class="progress-fill" id="progressFill"></div>
        </div>
    </div>

    <script type="module">
        // Embed the web worker as a data URL
        const workerCode = ${JSON.stringify(workerContent)};
        const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);

        // Override the Worker constructor to use our embedded worker
        const originalWorker = globalThis.Worker;
        globalThis.Worker = class extends originalWorker {
          constructor(scriptURL, options) {
            if (scriptURL.href && scriptURL.href.includes('pitch-shifter.worker')) {
              super(workerUrl, options);
            } else {
              super(scriptURL, options);
            }
          }
        };

        ${jsContent}
    </script>
</body>
</html>`;

    // Write the HTML file
    const outputPath = path.join(distDir, "index.html");
    fs.writeFileSync(outputPath, htmlTemplate);

    // Clean up separate JavaScript files since they're now embedded
    const filesToRemove = [
      path.join(distDir, "index.js"),
      path.join(distDir, "index.js.map"),
      path.join(distDir, "pitch-shifter.worker.js"),
      path.join(distDir, "pitch-shifter.worker.js.map"),
      path.join(distDir, "node_modules"),
    ];

    filesToRemove.forEach((file) => {
      if (fs.existsSync(file)) {
        if (fs.statSync(file).isDirectory()) {
          fs.rmSync(file, { recursive: true, force: true });
        } else {
          fs.unlinkSync(file);
        }
      }
    });

    console.log(`✅ Build complete! Output: ${outputPath}`);
    console.log(`📦 WASM files embedded directly in JavaScript bundle`);
    console.log(`🚀 Single HTML file created - ready to use!`);

    if (isDev) {
      console.log("🔧 Development mode - serving files...");
      const http = require("http");
      const server = http.createServer((req, res) => {
        let filePath = path.join(
          distDir,
          req.url === "/" ? "index.html" : req.url
        );

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentType =
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".wasm": "application/wasm",
              ".css": "text/css",
            }[ext] || "text/plain";

          res.writeHead(200, {
            "Content-Type": contentType,
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Opener-Policy": "same-origin",
          });

          if (ext === ".wasm") {
            res.end(fs.readFileSync(filePath));
          } else {
            res.end(fs.readFileSync(filePath, "utf8"));
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      server.listen(3001, () => {
        console.log("🌐 Server running at http://localhost:3001");
      });
    }
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

function getCSSContent() {
  try {
    return fs.readFileSync(path.join(__dirname, "src/styles/main.css"), "utf8");
  } catch (error) {
    console.warn("Could not load CSS file:", error.message);
    return "";
  }
}

build();
