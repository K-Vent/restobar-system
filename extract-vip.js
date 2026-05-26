const fs = require('fs');
const readline = require('readline');

async function extractVipHtml() {
    const logPath = 'C:\\Users\\jeffg\\.gemini\\antigravity\\brain\\34228d21-a5b0-4460-8c4c-668b98ada4cb\\.system_generated\\logs\\transcript.jsonl';
    const fileStream = fs.createReadStream(logPath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let foundContents = [];

    for await (const line of rl) {
        try {
            const entry = JSON.parse(line);
            if (entry.tool_calls) {
                for (const call of entry.tool_calls) {
                    if ((call.name === 'write_to_file' || call.name === 'multi_replace_file_content' || call.name === 'replace_file_content') && 
                        call.args && call.args.TargetFile && call.args.TargetFile.includes('vip.html')) {
                        foundContents.push({
                            step: entry.step_index,
                            tool: call.name,
                            content: call.args.CodeContent || call.args.ReplacementContent || call.args.ReplacementChunks
                        });
                    }
                }
            }
        } catch (e) {
            // ignore parse errors
        }
    }

    console.log(`Found ${foundContents.length} modifications to vip.html`);
    // Save the very first write_to_file to a text file to inspect
    if (foundContents.length > 0) {
        const firstWrite = foundContents.find(c => c.tool === 'write_to_file');
        if (firstWrite) {
            fs.writeFileSync('C:\\Users\\jeffg\\Desktop\\Sistema BIllar\\recovered_vip.html', firstWrite.content);
            console.log("Saved the earliest write_to_file content to recovered_vip.html");
        }
    }
}

extractVipHtml();
