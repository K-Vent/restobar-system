const fs = require('fs');

const file = 'c:\\Users\\jeffg\\Desktop\\Sistema BIllar\\private\\reportes.html';
let content = fs.readFileSync(file, 'utf8');

// Fix headers
const h4Regex = /<h4 class="fw-bold mb-0 text-white".*?>.*?<\/h4>/;
const match = content.match(h4Regex);
if(match) {
    let text = match[0].replace(/<[^>]+>/g, '').replace(/[^\x00-\x7F]/g, '').trim();
    const newH4 = `<h4 class="fw-bold mb-0 text-white" style="letter-spacing: 1px; display:flex; align-items:center; gap:8px;"><i data-lucide="bar-chart-3" style="color: var(--gold);"></i> ${text}</h4>`;
    content = content.replace(h4Regex, newH4);
}

// Fix chart colors
content = content.replace("const colorVerde = '#2ecc71'; const colorMorado = '#8e44ad'; const colorAzul = '#2980b9';", 
                          "const colorVerde = '#059669'; const colorMorado = '#7c3aed'; const colorAzul = '#475569';");

fs.writeFileSync(file, content);
console.log("Fixed reportes.html");
