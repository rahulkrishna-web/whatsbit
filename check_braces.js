const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf8');
let stack = [];
for (let i = 0; i < content.length; i++) {
  const c = content[i];
  if (c === '{' || c === '(' || c === '<') {
    // Only check basic '{' and '(' to simplify, JSX '<' is harder to parse manually
  }
}
