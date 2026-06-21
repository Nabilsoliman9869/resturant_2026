const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const docxPath = 'E:\\XTRA_WEB\\مطاعم\\متطلبات_نظام_المطعم.docx';
const extractDir = 'E:\\XTRA_WEB\\مطاعم\\_temp_docx_extract';

if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

try {
  execSync(`tar -xf "${docxPath}" -C "${extractDir}"`, { stdio: 'ignore' });
  const xmlPath = path.join(extractDir, 'word', 'document.xml');
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  fs.writeFileSync('E:\\XTRA_WEB\\مطاعم\\_temp_req.txt', text, 'utf8');
  console.log('done');
} catch (e) {
  console.error('error:', e.message);
}
