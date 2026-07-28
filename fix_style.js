const fs = require('fs');
let html = fs.readFileSync('Scripts/generate_html.js', 'utf8');

html = html.replace(/<style>\r?\n\s*justify-content: center;/, `<style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #000000;
        color: #e7e9ea;
        margin: 0;
        padding: 40px 20px;
        display: flex;
        justify-content: center;`);

fs.writeFileSync('Scripts/generate_html.js', html);
