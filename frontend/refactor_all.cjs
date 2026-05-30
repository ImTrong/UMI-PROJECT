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

  // Replace Tailwind color classes
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-indigo-/g, '$1-emerald-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-blue-/g, '$1-cyan-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-purple-/g, '$1-teal-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-violet-/g, '$1-teal-');

  // Emojis to replace and their corresponding icons
  const emojiMap = {
    '🤖': 'FiCpu',
    '📚': 'FiBook',
    '🎓': 'FiAward',
    '💡': 'FiLightbulb',
    '💻': 'FiMonitor',
    '📝': 'FiEdit3',
    '🔄': 'FiRefreshCw',
    '📅': 'FiCalendar',
    '⭐': 'FiStar'
  };

  let usedIcons = new Set();
  
  for (const [emoji, icon] of Object.entries(emojiMap)) {
    if (content.includes(emoji)) {
      if (emoji === '⭐') {
         content = content.replace(new RegExp(emoji, 'g'), `<${icon} className="inline fill-current" />`);
      } else {
         content = content.replace(new RegExp(emoji, 'g'), `<${icon} className="inline mr-1" />`);
      }
      usedIcons.add(icon);
    }
  }

  // Handle imports if any emojis were replaced
  if (usedIcons.size > 0) {
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]react-icons\/fi['"];?/;
    const match = content.match(importRegex);
    
    if (match) {
      // Existing import found, append new icons if not present
      let existingIcons = match[1].split(',').map(i => i.trim());
      let newIcons = [...existingIcons];
      
      for (const icon of usedIcons) {
        if (!existingIcons.includes(icon)) {
          newIcons.push(icon);
        }
      }
      
      content = content.replace(importRegex, `import { ${newIcons.join(', ')} } from 'react-icons/fi';`);
    } else {
      // No existing import, add it after the last import statement or at the top
      const iconList = Array.from(usedIcons).join(', ');
      const importStatement = `import { ${iconList} } from 'react-icons/fi';\n`;
      
      // Find last import
      const lastImportIndex = content.lastIndexOf('import ');
      if (lastImportIndex !== -1) {
        const endOfLastImport = content.indexOf('\n', lastImportIndex);
        content = content.slice(0, endOfLastImport + 1) + importStatement + content.slice(endOfLastImport + 1);
      } else {
        content = importStatement + content;
      }
    }
  }

  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated ${path.basename(fullPath)}`);
  }
}

// Start processing from src
processDirectory(path.join(__dirname, 'src'));
