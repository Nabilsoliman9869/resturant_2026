const fs = require('fs');
['src/styles/operationalRoles.css', 'src/styles/appShell.css', 'src/styles/waiterUiEase.css', 'ui/restaurant/index.html'].forEach(f => {
  const b = fs.readFileSync(f);
  const hex = Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log(f + ': ' + hex);
});
