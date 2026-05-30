const fs = require('fs');
const path = require('path');

function processDirectory(directory) {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

function processFile(fullPath) {
  let content = fs.readFileSync(fullPath, 'utf8');
  let original = content;

  // Colors: Gray to Slate
  content = content.replace(/bg-gray-/g, 'bg-slate-');
  content = content.replace(/text-gray-/g, 'text-slate-');
  content = content.replace(/border-gray-/g, 'border-slate-');
  content = content.replace(/ring-gray-/g, 'ring-slate-');
  content = content.replace(/hover:bg-gray-/g, 'hover:bg-slate-');
  content = content.replace(/hover:text-gray-/g, 'hover:text-slate-');
  content = content.replace(/hover:border-gray-/g, 'hover:border-slate-');

  // Shadows: Make them softer/flatter
  content = content.replace(/shadow-2xl/g, 'shadow-md');
  content = content.replace(/shadow-xl/g, 'shadow-md');
  content = content.replace(/shadow-lg/g, 'shadow-sm');
  content = content.replace(/shadow-md/g, 'shadow-sm');

  // Borders: Softer
  content = content.replace(/border-slate-200/g, 'border-slate-100');
  content = content.replace(/border-slate-300/g, 'border-slate-200');

  // Radiuses: More modern (rounder)
  content = content.replace(/rounded-lg/g, 'rounded-xl');
  content = content.replace(/rounded-md/g, 'rounded-lg');

  // Specific heavy gradients removal (replace with flat or very subtle gradient)
  content = content.replace(/bg-gradient-to-r from-primary-600 to-primary-500/g, 'bg-emerald-600');
  content = content.replace(/bg-gradient-to-r from-emerald-600 to-teal-500/g, 'bg-emerald-600');
  
  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated ${path.basename(fullPath)}`);
  }
}

// Start processing from src
processDirectory(path.join(__dirname, 'src'));
