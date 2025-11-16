# pdf-extractor
Pdf Image Extractor

# PDF Image Labeling and Extraction Tool (Electron)

This is an Electron desktop application designed to process catalog-style PDFs, automatically extract unique accession numbers and descriptions (e.g., `YYYY.NN.MM...`), and save placeholder image data (representing the extracted photos) using these labels as the file names.

The core logic uses the **`pdf-parse`** Node.js library to read the PDF's text content and a **Regular Expression** to generalize the labeling for any PDF following the `[Four Digits].[Number].[Number] [Description]` pattern.

## Prerequisites

1.  **Node.js:** Must be installed (LTS version recommended).
2.  **Git:** To manage the repository.
3.  **VS Code:** (Recommended) for development.

## Setup Instructions

### 1. Install Dependencies

Open your terminal or command prompt, navigate to the root of this repository, and run:

```bash
# Install Electron and the pdf-parse library
npm install
