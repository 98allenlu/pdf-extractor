// pdf-extract-library.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');
const pdf = require('pdf-parse');
const _ = require('lodash');

// Regex used to find artifact/accession-like strings in text
const ARTIFACT_ID_REGEX = /(\d{4}\.\d{1,3}\.\d{1,3}[a-z]?[-\w]*(?:\s[\w\s,]+)?)/g;

// If you want to hardcode a Poppler bin dir, put it here (otherwise leave null to use system PATH)
const POPPLER_PATH = null;

/**
 * Attempt to load the node-poppler wrapper in a tolerant way.
 * Returns constructor/class if found, otherwise null.
 */
function tryLoadNodePoppler() {
  try {
    const mod = require('node-poppler');
    // node-poppler historically exports differently across versions; try the common shapes:
    return mod.Poppler || mod.NodePoppler || mod.default || mod;
  } catch (e) {
    // Not installed or failed to load
    return null;
  }
}

/**
 * Run pdftocairo CLI to create PNG pages into outPrefix (outPrefix will be used as prefix).
 * Returns a promise that resolves when command completes.
 */
function runPdftocairoCli(pdfPath, outPrefix, { firstPage, lastPage } = {}) {
  return new Promise((resolve, reject) => {
    // prefer pdftocairo on PATH; allow POPPLER_PATH override (POPPLER_PATH could be a folder)
    const exe = POPPLER_PATH ? path.join(POPPLER_PATH, 'pdftocairo') : 'pdftocairo';
    // build args. -png for PNG output, -f/-l for page range
    const args = ['-png'];
    if (firstPage) args.push('-f', String(firstPage));
    if (lastPage) args.push('-l', String(lastPage));
    // outPrefix becomes e.g. C:\temp\img_
    args.push(pdfPath, outPrefix);

    const proc = child_process.spawn(exe, args, { shell: false });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`Failed to spawn pdftocairo: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftocairo exited ${code}. stderr: ${stderr}`));
    });
  });
}

/**
 * Main exported function: extracts text labels and images, returns images with labels and the tempDir path.
 * @param {string} pdfFilePath
 */
async function extractImagesAndLabels(pdfFilePath) {
  if (!pdfFilePath || !fs.existsSync(pdfFilePath)) {
    throw new Error(`PDF not found: ${pdfFilePath}`);
  }

  // create temp dir for extracted images
  const tempDir = path.join(os.tmpdir(), `pdf-extract-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // 1) Extract text using pdf-parse
  const dataBuffer = fs.readFileSync(pdfFilePath);
  const parsed = await pdf(dataBuffer);
  const pdfText = parsed.text || '';
  const totalPages = parsed.numpages || 0;

  // find labels
  let foundLabels = [];
  let m;
  while ((m = ARTIFACT_ID_REGEX.exec(pdfText)) !== null) {
    const label = m[0].trim();
    if (label && !foundLabels.includes(label)) foundLabels.push(label);
  }

  // 2) Try node-poppler first (if available), else fallback to CLI pdftocairo
  const PopplerClass = tryLoadNodePoppler();

  const outPrefix = path.join(tempDir, 'img_'); // pdftocairo will append -1.png, -2.png, or img_1.png etc.

  try {
    if (PopplerClass) {
      // Use Node wrapper
      const poppler = new PopplerClass(POPPLER_PATH || undefined);
      // node-poppler API may differ: try pdfToCairo or pdfToCairoSync depending on wrapper
      if (typeof poppler.pdfToCairo === 'function') {
        await poppler.pdfToCairo(pdfFilePath, {
          png: true,
          singleFile: false,
          firstPage: 1,
          lastPage: totalPages,
          outPrefix
        });
      } else if (typeof poppler.pdfToCairoSync === 'function') {
        poppler.pdfToCairoSync(pdfFilePath, {
          png: true,
          singleFile: false,
          firstPage: 1,
          lastPage: totalPages,
          outPrefix
        });
      } else {
        // Unknown API shape — fallback to CLI
        await runPdftocairoCli(pdfFilePath, outPrefix, { firstPage: 1, lastPage: totalPages });
      }
    } else {
      // No node-poppler — run CLI directly
      await runPdftocairoCli(pdfFilePath, outPrefix, { firstPage: 1, lastPage: totalPages });
    }
  } catch (e) {
    // Clean up created tempDir on failure
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw new Error(`Image extraction failed (Poppler required). Details: ${e.message}`);
  }

  // 3) Collect PNG files created in tempDir
  let extractedFiles = fs.readdirSync(tempDir)
    .filter(f => /\.png$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Not all pdftocairo naming schemes are identical; check for img-1.png or img_1.png
  if (extractedFiles.length === 0) {
    // attempt alternative file patterns
    extractedFiles = fs.readdirSync(tempDir)
      .filter(f => /img[-_]\d+\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  // prepare results pairing labels -> images by order (best-effort)
  const count = Math.min(foundLabels.length, extractedFiles.length);
  const results = [];

  for (let i = 0; i < count; i++) {
    const label = foundLabels[i] || `item-${i+1}`;
    const fileName = extractedFiles[i];
    const filePath = path.join(tempDir, fileName);
    try {
      const buf = fs.readFileSync(filePath);
      results.push({
        name: `${label}.png`,
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`
      });
    } catch (err) {
      // skip file if can't read
      console.warn(`Could not read extracted image ${filePath}: ${err.message}`);
    }
  }

  // If we didn't find labels OR images, still return what we have (empty arrays)
  return {
    imagesWithLabels: results,
    tempDirectory: tempDir
  };
}

module.exports = {
  extractImagesAndLabels
};
