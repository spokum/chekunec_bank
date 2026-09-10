const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let html = read('index.html');

html = html.replace('<link rel="stylesheet" href="assets/styles.css">',
  () => '<style>\n' + read('assets/styles.css') + '\n</style>');

['assets/config.js', 'assets/api.js', 'assets/app.js'].forEach(f => {
  html = html.replace('<script src="' + f + '"></script>',
    () => '<script>\n' + read(f) + '\n</script>');
});

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/chekunec-bank.html'), html);
console.log('dist/chekunec-bank.html — ' + Math.round(html.length / 1024) + ' КБ');

const inner = html
  .replace(/^[\s\S]*?<head>/, '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '')
  .split('\n')
  .filter(line => !/^\s*<(meta|link)\b/.test(line))
  .join('\n');
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), inner.trim() + '\n');
console.log('dist/artifact.html — ' + Math.round(inner.length / 1024) + ' КБ');
