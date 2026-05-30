const fs = require('fs');
const path = require('path');

const files = [
  'src/pages/Learning.tsx',
  'src/pages/MyLearning.tsx',
  'src/pages/MyTasks.tsx',
  'src/pages/QuizPage.tsx',
  'src/pages/StudentDashboard.tsx',
  'src/pages/Profile.tsx',
  'src/pages/LearningAnalytics.tsx',
  'src/pages/LearningPaths.tsx'
];

function processFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`Skipping ${filePath} - not found`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let original = content;

  // Replace Tailwind color classes
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-indigo-/g, '$1-emerald-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-blue-/g, '$1-cyan-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-purple-/g, '$1-teal-');
  content = content.replace(/(bg|text|border|from|via|to|ring|shadow)-violet-/g, '$1-teal-');

  // Specific Emoji replacements
  // LearningAnalytics.tsx
  if (filePath.includes('LearningAnalytics.tsx')) {
    content = content.replace(/📅/g, '<FiCalendar className="text-emerald-500" />');
    if (!content.includes('FiCalendar')) {
      content = content.replace(/import \{([^}]+)\} from 'react-icons\/fi';/, "import { $1, FiCalendar } from 'react-icons/fi';");
    }
  }

  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  } else {
    console.log(`No changes in ${filePath}`);
  }
}

files.forEach(processFile);
