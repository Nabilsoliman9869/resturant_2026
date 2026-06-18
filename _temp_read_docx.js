const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// docx is a zip file; use tar (built-in on modern Windows) to extract
const docxPath = 'E:\\XTRA_WEB\\مطاعم\\متطلبات_نظام_المطعم.docx';
const extractDir = 'E:\\XTRA_WEB\\مطاعم\\_temp_docx_extract';

if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

// Use tar to extract (Windows 10+ supports tar for zip files)
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
