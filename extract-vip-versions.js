const fs = require('fs');
const lines = fs.readFileSync('C:\\Users\\jeffg\\Desktop\\Sistema BIllar\\vip_log_lines.jsonl', 'utf8').split('\n').filter(Boolean);

let count = 1;
lines.forEach(line => {
    try {
        const obj = JSON.parse(line);
        if (obj.tool_calls) {
            obj.tool_calls.forEach(tc => {
                if (tc.name === 'write_to_file' && tc.args.TargetFile.includes('vip.html')) {
                    fs.writeFileSync(`C:\\Users\\jeffg\\Desktop\\Sistema BIllar\\vip_version_${count}.html`, tc.args.CodeContent);
                    console.log(`Saved vip_version_${count}.html`);
                    count++;
                }
            });
        }
    } catch (e) {}
});
