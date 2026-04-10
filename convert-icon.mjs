import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, 'icon.png');
const tempPngPath = path.join(__dirname, 'temp_icon.png');
const outputPath = path.join(__dirname, 'icon.ico');

async function convert() {
    try {
        console.log('이미지 정규화 중 (PNG 변환 및 리사이징)...');
        await sharp(inputPath)
            .resize(256, 256)
            .png()
            .toFile(tempPngPath);

        console.log('ICO 변환 중...');
        const buf = await pngToIco(tempPngPath);
        fs.writeFileSync(outputPath, buf);
        
        fs.unlinkSync(tempPngPath); // 임시 파일 삭제
        console.log('icon.ico 파일이 성공적으로 생성되었습니다!');
    } catch (err) {
        console.error('아이콘 변환 실패:', err);
    }
}

convert();
