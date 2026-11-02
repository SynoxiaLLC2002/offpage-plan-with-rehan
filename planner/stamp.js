// Gives app.js / style.css a new ?v= on every deploy, so browsers can cache them forever but still get updates.
const fs = require('fs'), f = __dirname + '/public/index.html', v = Date.now().toString(36);
const html = fs.readFileSync(f, 'utf8').replace(/\/(app\.js|style\.css)(\?v=[a-z0-9]+)?"/g, `/$1?v=${v}"`);
fs.writeFileSync(f, html);
console.log('stamped', v, (html.match(/\?v=/g) || []).length, 'files');
