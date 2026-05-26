const fs = require('fs');
const path = require('path');
const emojiRegex = require('emoji-regex');

function removeEmojis(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('.gemini') || fullPath.endsWith('.png') || fullPath.endsWith('.jpg') || fullPath.endsWith('.ico')) continue;
        
        if (fs.statSync(fullPath).isDirectory()) {
            removeEmojis(fullPath);
        } else if (fullPath.endsWith('.html') || fullPath.endsWith('.js') || fullPath.endsWith('.css') || fullPath.endsWith('.json')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            const regex = emojiRegex();
            
            let original = content;
            // Reemplazar emojis. También limpiar los espacios extras dejados
            content = content.replace(regex, '');
            
            // Reemplazar ciertos caracteres Unicode extras que a veces se usan como iconos y no son pillados por emojiRegex
            // como  (Gear con VS16), , , , etc si no están incluidos.
            // emojiRegex captura la gran mayoría.
            // Para asegurar, removeremos el variation selector 16 (\uFE0F) que a veces queda "huerfano"
            content = content.replace(/\uFE0F/g, '');
            
            if (original !== content) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Limpiado:', fullPath);
            }
        }
    }
}

removeEmojis(__dirname);
console.log(' Eliminación de emojis completada.');
