const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--dev');

// Plugin to embed WASM files as Uint8Array
const wasmEmbedPlugin = {
  name: 'wasm-embed',
  setup(build) {
    // Handle rubberband-wasm module
    build.onResolve({ filter: /^@echogarden\/rubberband-wasm$/ }, (args) => {
      return { path: args.path, namespace: 'wasm-embed' };
    });
    
    build.onLoad({ filter: /.*/, namespace: 'wasm-embed' }, () => {
      const wasmPath = path.join(__dirname, 'node_modules/@echogarden/rubberband-wasm/rubberband.wasm');
      const jsPath = path.join(__dirname, 'node_modules/@echogarden/rubberband-wasm/rubberband.js');
      
      const wasmData = fs.readFileSync(wasmPath);
      const jsCode = fs.readFileSync(jsPath, 'utf8');
      
      // Convert WASM to base64 for embedding
      const wasmBase64 = wasmData.toString('base64');
      
      return {
        contents: `
          // Embedded WASM data as base64
          const wasmBase64 = "${wasmBase64}";
          const wasmBinary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
          
          // Load the rubberband.js code and modify its exports
          ${jsCode.replace('export default Rubberband;', '// export default Rubberband;')}
          
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
        loader: 'js'
      };
    });
  }
};

async function build() {
  try {
    // Ensure dist directory exists
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    // Build configuration for normal web app
    const buildConfig = {
      entryPoints: ['src/index.ts'],
      bundle: true,
      minify: !isDev,
      sourcemap: isDev,
      outdir: 'dist',
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      define: {
        'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
        'global': 'globalThis'
      },
      external: [],
      plugins: [
        wasmEmbedPlugin,
        // Plugin to handle Node.js modules
        {
          name: 'node-modules',
          setup(build) {
            build.onResolve({ filter: /^module$/ }, (args) => {
              return { path: args.path, namespace: 'node-stub' };
            });
            
            build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => {
              return {
                contents: `
                  export const createRequire = () => {
                    throw new Error('require is not supported in browser environment');
                  };
                  export default { createRequire };
                `,
                loader: 'js'
              };
            });
          }
        }
      ]
    };

    console.log('Building JavaScript bundle...');
    const result = await esbuild.build(buildConfig);

    if (result.errors.length > 0) {
      console.error('Build errors:', result.errors);
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.warn('Build warnings:', result.warnings);
    }

    // Read the generated JavaScript file
    const jsFilePath = path.join(distDir, 'index.js');
    const jsContent = fs.readFileSync(jsFilePath, 'utf8');

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
        ${jsContent}
    </script>
</body>
</html>`;

    // Write the HTML file
    const outputPath = path.join(distDir, 'index.html');
    fs.writeFileSync(outputPath, htmlTemplate);

    // Clean up separate JavaScript files since they're now embedded
    const filesToRemove = [
      path.join(distDir, 'index.js'),
      path.join(distDir, 'index.js.map'),
      path.join(distDir, 'node_modules')
    ];
    
    filesToRemove.forEach(file => {
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
      console.log('🔧 Development mode - serving files...');
      const http = require('http');
      const server = http.createServer((req, res) => {
        let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);
        
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const contentType = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.wasm': 'application/wasm',
            '.css': 'text/css'
          }[ext] || 'text/plain';
          
          res.writeHead(200, { 
            'Content-Type': contentType,
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
          });
          
          if (ext === '.wasm') {
            res.end(fs.readFileSync(filePath));
          } else {
            res.end(fs.readFileSync(filePath, 'utf8'));
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      
      server.listen(3000, () => {
        console.log('🌐 Server running at http://localhost:3000');
      });
    }

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

function getCSSContent() {
  try {
    return fs.readFileSync(path.join(__dirname, 'src/styles/main.css'), 'utf8');
  } catch (error) {
    console.warn('Could not load CSS file:', error.message);
    return '';
  }
}

build();