const fs = require('fs');
const path = require('path');

const directories = ['dist', 'build', '.cache'];

directories.forEach(dir => {
  const dirPath = path.join(process.cwd(), dir);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`Cleaned ${dir}`);
  }
});

console.log('Clean completed');