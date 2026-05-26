const fs = require('fs');

const logPath = 'C:\\Users\\jeffg\\.gemini\\antigravity\\brain\\34228d21-a5b0-4460-8c4c-668b98ada4cb\\.system_generated\\logs\\transcript.jsonl';
const content = fs.readFileSync(logPath, 'utf8');

const lines = content.split('\n');
const vipLines = lines.filter(l => l.includes('vip.html') && (l.includes('write_to_file') || l.includes('replace_file_content')));

console.log(`Found ${vipLines.length} lines mentioning vip.html and a file write tool.`);
if (vipLines.length > 0) {
    fs.writeFileSync('C:\\Users\\jeffg\\Desktop\\Sistema BIllar\\vip_log_lines.jsonl', vipLines.join('\n'));
}
