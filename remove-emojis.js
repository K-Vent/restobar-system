const fs = require('fs');
const path = require('path');

// Regex to match emojis
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{238C}-\u{2454}\u{20D0}-\u{20FF}\u{1F004}\u{1F0CF}\u{1F18E}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{1F004}-\u{1F0CF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}]+/gu;

const directoriesToClean = [
    path.join(__dirname, 'private'),
    path.join(__dirname, 'controllers'),
    path.join(__dirname, 'public')
];

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            processDirectory(fullPath);
        } else if (file.endsWith('.html') || file.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let hasEmoji = false;
            
            // Clean up specific leftover strings first to keep formatting nice
            const specificReplacements = {
                'Oro 👑': 'Oro',
                '🔥': '',
                '🔒': '',
                '⚠️': '',
                '❌': '',
                '✅': '',
                '🗑️': '',
                '📸': '',
                '💸': '',
                '🎁': '',
                '💳': '',
                '➕': '',
                '📈': '',
                '📉': '',
                '👥': '',
                '👨‍🍳': '',
                '🍔': '',
                '🍸': '',
                '🍟': '',
                '🍹': '',
                '⚖️': '',
                '🟣': '',
                '💼': '',
                '💬': '',
                '⚙️': '',
                '🔄': '',
                '▶': ''
            };

            for (const [emoji, replacement] of Object.entries(specificReplacements)) {
                if (content.includes(emoji)) {
                    content = content.split(emoji).join(replacement);
                    hasEmoji = true;
                }
            }
            
            // Catch-all regex
            if (emojiRegex.test(content)) {
                content = content.replace(emojiRegex, '');
                hasEmoji = true;
            }

            if (hasEmoji) {
                fs.writeFileSync(fullPath, content);
                console.log(`Cleaned emojis from: ${fullPath}`);
            }
        }
    }
}

directoriesToClean.forEach(processDirectory);
console.log('Emoji cleanup complete.');
