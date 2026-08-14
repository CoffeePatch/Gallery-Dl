const fs = require('fs');
const path = require('path');
const { ROOT_DIR, TWEET_DATA_DIR, RAW_DATA_DIR } = require('../lib/paths');

/**
 * Format metrics (1.2K, 452K)
 */
function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    if (typeof num === 'string' && !isNaN(num)) num = Number(num);
    if (typeof num === 'number') {
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
    }
    return String(num);
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Reads natural pixel dimensions (width & height) from local JPEG or PNG files
 */
function getImageDimensions(imagePathOrUrl) {
    if (!imagePathOrUrl) return { width: 800, height: 1000 };
    if (typeof imagePathOrUrl === 'object' && imagePathOrUrl.width && imagePathOrUrl.height) {
        return { width: imagePathOrUrl.width, height: imagePathOrUrl.height };
    }

    const cleanPath = String(typeof imagePathOrUrl === 'object' ? (imagePathOrUrl.url || imagePathOrUrl.media_url_https || '') : imagePathOrUrl).replace(/^file:\/\/\/?/, '');

    if (fs.existsSync(cleanPath)) {
        try {
            const buffer = fs.readFileSync(cleanPath);
            // PNG Reader
            if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
            }
            // JPEG Reader
            if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
                let i = 2;
                while (i < buffer.length - 8) {
                    if (buffer[i] === 0xFF) {
                        const marker = buffer[i + 1];
                        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3) {
                            return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
                        }
                        i += 2 + buffer.readUInt16BE(i + 2);
                    } else {
                        i++;
                    }
                }
            }
        } catch (e) {}
    }
    return { width: 800, height: 1080 }; // Default 4:5 aspect ratio fallback
}

/**
 * Converts image path/url to Base64 Data URI
 */
function toBase64Uri(imagePathOrUrl) {
    if (!imagePathOrUrl) return '';
    const srcStr = typeof imagePathOrUrl === 'object' ? (imagePathOrUrl.url || imagePathOrUrl.media_url_https || '') : imagePathOrUrl;
    if (srcStr.startsWith('data:image/')) return srcStr;
    
    const cleanPath = srcStr.replace(/^file:\/\/\/?/, '');
    if (fs.existsSync(cleanPath)) {
        try {
            const ext = path.extname(cleanPath).substring(1).toLowerCase() || 'jpeg';
            const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
            const b64 = fs.readFileSync(cleanPath, 'base64');
            return `data:${mime};base64,${b64}`;
        } catch (e) {}
    }
    return srcStr;
}

/**
 * Renders FREED-DIMENSION Media Grids:
 * - NO fixed overlay boxes!
 * - NO black pillarbox/letterbox bars!
 * - Every photo box height is calculated FREELY from its REAL natural aspect ratio!
 * - Tweet card height expands dynamically to accommodate natural photo heights!
 */
function renderFreedDimensionsMediaSection(mediaList = [], mediaY = 0, options = { useBase64: true }) {
    if (!Array.isArray(mediaList)) {
        mediaList = mediaList ? [mediaList] : [];
    }
    if (mediaList.length === 0) {
        return { mediaNode: '', mediaHeight: 0 };
    }

    const maxGridWidth = 552;
    const gap = 8;
    let nodeContent = '';
    let totalMediaHeight = 0;

    const processedItems = mediaList.map(m => {
        const rawUrl = typeof m === 'object' ? (m.url || m.media_url_https || '') : m;
        const dims = getImageDimensions(m);
        const b64 = options.useBase64 ? toBase64Uri(m) : rawUrl;
        return { url: b64, width: dims.width, height: dims.height, aspect: dims.width / dims.height };
    });

    if (processedItems.length === 1) {
        // 1 IMAGE: Natural Uncropped Height (width=552px, height calculated freely from image aspect ratio!)
        const item = processedItems[0];
        const calcHeight = Math.min(650, Math.max(220, Math.round(maxGridWidth / item.aspect)));
        totalMediaHeight = calcHeight;

        nodeContent = `
  <!-- 1 IMAGE (Freed Dimensions: ${maxGridWidth}px x ${calcHeight}px) -->
  <g id="media-card-1" transform="translate(24, ${mediaY})">
    <clipPath id="free-clip-1">
      <rect x="0" y="0" width="${maxGridWidth}" height="${calcHeight}" rx="16" ry="16" />
    </clipPath>
    <rect x="0" y="0" width="${maxGridWidth}" height="${calcHeight}" rx="16" ry="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(item.url)}" x="0" y="0" width="${maxGridWidth}" height="${calcHeight}" clip-path="url(#free-clip-1)" preserveAspectRatio="xMidYMin slice"/>
  </g>`;
    } else if (processedItems.length === 2) {
        // 2 IMAGES: Side-by-side vertical columns with INDIVIDUAL FREED HEIGHTS (Matches user reference screenshots 2 & 3!)
        const colWidth = Math.floor((maxGridWidth - gap) / 2); // 272px

        const h1 = Math.min(520, Math.max(260, Math.round(colWidth / processedItems[0].aspect)));
        const h2 = Math.min(520, Math.max(260, Math.round(colWidth / processedItems[1].aspect)));
        
        totalMediaHeight = Math.max(h1, h2);

        nodeContent = `
  <!-- 2 IMAGES (Freed Natural Heights: Left=${h1}px, Right=${h2}px) -->
  <g id="media-card-freed-2" transform="translate(24, ${mediaY})">
    <clipPath id="free-clip-2-left">
      <rect x="0" y="0" width="${colWidth}" height="${h1}" rx="16" ry="16" />
    </clipPath>
    <clipPath id="free-clip-2-right">
      <rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="16" ry="16" />
    </clipPath>

    <!-- Left Photo (Height: ${h1}px) -->
    <rect x="0" y="0" width="${colWidth}" height="${h1}" rx="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(processedItems[0].url)}" x="0" y="0" width="${colWidth}" height="${h1}" clip-path="url(#free-clip-2-left)" preserveAspectRatio="xMidYMin slice"/>

    <!-- Right Photo (Height: ${h2}px) -->
    <rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(processedItems[1].url)}" x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" clip-path="url(#free-clip-2-right)" preserveAspectRatio="xMidYMin slice"/>
  </g>`;
    } else if (processedItems.length === 3) {
        // 3 IMAGES: 2 Top Columns + 1 Bottom Centered Column with FREED NATURAL HEIGHTS (Matches user reference screenshot 1!)
        const colWidth = Math.floor((maxGridWidth - gap) / 2); // 272px

        const h1 = Math.min(480, Math.max(260, Math.round(colWidth / processedItems[0].aspect)));
        const h2 = Math.min(480, Math.max(260, Math.round(colWidth / processedItems[1].aspect)));
        const topRowHeight = Math.max(h1, h2);

        const h3 = Math.min(480, Math.max(260, Math.round(colWidth / processedItems[2].aspect)));
        const bottomY = topRowHeight + gap;

        totalMediaHeight = topRowHeight + gap + h3;
        const bottomX = Math.floor((maxGridWidth - colWidth) / 2); // 140px centered

        nodeContent = `
  <!-- 3 IMAGES (Freed Natural Heights: TopLeft=${h1}px, TopRight=${h2}px, BottomCentered=${h3}px) -->
  <g id="media-card-freed-3" transform="translate(24, ${mediaY})">
    <clipPath id="free-clip-3-tl"><rect x="0" y="0" width="${colWidth}" height="${h1}" rx="16" ry="16" /></clipPath>
    <clipPath id="free-clip-3-tr"><rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="16" ry="16" /></clipPath>
    <clipPath id="free-clip-3-bottom"><rect x="${bottomX}" y="${bottomY}" width="${colWidth}" height="${h3}" rx="16" ry="16" /></clipPath>

    <!-- Top Left Photo (Height: ${h1}px) -->
    <rect x="0" y="0" width="${colWidth}" height="${h1}" rx="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(processedItems[0].url)}" x="0" y="0" width="${colWidth}" height="${h1}" clip-path="url(#free-clip-3-tl)" preserveAspectRatio="xMidYMin slice"/>

    <!-- Top Right Photo (Height: ${h2}px) -->
    <rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(processedItems[1].url)}" x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" clip-path="url(#free-clip-3-tr)" preserveAspectRatio="xMidYMin slice"/>

    <!-- Bottom Centered Photo (Height: ${h3}px) -->
    <rect x="${bottomX}" y="${bottomY}" width="${colWidth}" height="${h3}" rx="16" fill="#16181C" stroke="#2F3336" stroke-width="1.5"/>
    <image href="${escapeXml(processedItems[2].url)}" x="${bottomX}" y="${bottomY}" width="${colWidth}" height="${h3}" clip-path="url(#free-clip-3-bottom)" preserveAspectRatio="xMidYMin slice"/>
  </g>`;
    } else {
        // 4 IMAGES: 2x2 Grid with Freed Natural Heights per row
        const colWidth = Math.floor((maxGridWidth - gap) / 2);

        const h1 = Math.min(380, Math.max(180, Math.round(colWidth / processedItems[0].aspect)));
        const h2 = Math.min(380, Math.max(180, Math.round(colWidth / processedItems[1].aspect)));
        const row1Height = Math.max(h1, h2);

        const h3 = Math.min(380, Math.max(180, Math.round(colWidth / processedItems[2].aspect)));
        const h4 = Math.min(380, Math.max(180, Math.round(colWidth / processedItems[3].aspect)));
        const row2Height = Math.max(h3, h4);

        const row2Y = row1Height + gap;
        totalMediaHeight = row1Height + gap + row2Height;

        nodeContent = `
  <!-- 4 IMAGES (Freed Natural Heights: TopLeft=${h1}px, TopRight=${h2}px, BottomLeft=${h3}px, BottomRight=${h4}px) -->
  <g id="media-card-freed-4" transform="translate(24, ${mediaY})">
    <clipPath id="free-clip-4-tl"><rect x="0" y="0" width="${colWidth}" height="${h1}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-tr"><rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-bl"><rect x="0" y="${row2Y}" width="${colWidth}" height="${h3}" rx="14" ry="14" /></clipPath>
    <clipPath id="free-clip-4-br"><rect x="${colWidth + gap}" y="${row2Y}" width="${colWidth}" height="${h4}" rx="14" ry="14" /></clipPath>

    <rect x="0" y="0" width="${colWidth}" height="${h1}" rx="14" fill="#16181C" stroke="#2F3336" stroke-width="1"/>
    <image href="${escapeXml(processedItems[0].url)}" x="0" y="0" width="${colWidth}" height="${h1}" clip-path="url(#free-clip-4-tl)" preserveAspectRatio="xMidYMin slice"/>

    <rect x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" rx="14" fill="#16181C" stroke="#2F3336" stroke-width="1"/>
    <image href="${escapeXml(processedItems[1].url)}" x="${colWidth + gap}" y="0" width="${colWidth}" height="${h2}" clip-path="url(#free-clip-4-tr)" preserveAspectRatio="xMidYMin slice"/>

    <rect x="0" y="${row2Y}" width="${colWidth}" height="${h3}" rx="14" fill="#16181C" stroke="#2F3336" stroke-width="1"/>
    <image href="${escapeXml(processedItems[2].url)}" x="0" y="${row2Y}" width="${colWidth}" height="${h3}" clip-path="url(#free-clip-4-bl)" preserveAspectRatio="xMidYMin slice"/>

    <rect x="${colWidth + gap}" y="${row2Y}" width="${colWidth}" height="${h4}" rx="14" fill="#16181C" stroke="#2F3336" stroke-width="1"/>
    <image href="${escapeXml(processedItems[3].url)}" x="${colWidth + gap}" y="${row2Y}" width="${colWidth}" height="${h4}" clip-path="url(#free-clip-4-br)" preserveAspectRatio="xMidYMin slice"/>
  </g>`;
    }

    return { mediaNode: nodeContent, mediaHeight: totalMediaHeight };
}

/**
 * Dynamic layout calculator
 */
function calculateLayout(text, estimatedMediaHeight = 0) {
    const rawLines = text.split('\n');
    let totalLines = 0;
    const maxCharsPerLine = 50;

    for (const line of rawLines) {
        if (line.trim().length === 0) {
            totalLines += 1;
        } else {
            totalLines += Math.max(1, Math.ceil(line.length / maxCharsPerLine));
        }
    }

    const lineHeight = 22;
    const textHeight = Math.max(36, totalLines * lineHeight);

    const textY = 88;
    let currentY = textY + textHeight + 16;

    let mediaY = 0;
    if (estimatedMediaHeight > 0) {
        mediaY = currentY;
        currentY += estimatedMediaHeight + 16;
    }

    const metaY = currentY;
    const dividerY = metaY + 18;
    const actionsY = dividerY + 14;
    const cardHeight = actionsY + 30;

    return {
        textY,
        textHeight,
        mediaY,
        metaY,
        dividerY,
        actionsY,
        cardHeight
    };
}

/**
 * Builds a perfected SVG Tweet Card with FREED DIMENSIONS & no fixed overlay containers
 */
function buildPerfectTweetSvg(tweetData, options = { useBase64: true }) {
    const displayName = tweetData.displayName || tweetData.name || 'Keerthy Suresh Fan Page';
    const handle = tweetData.handle || '@keerthy_and_etc';
    const rawAvatarUrl = tweetData.avatarUrl || 'https://pbs.twimg.com/profile_images/2058755107362365440/SOYUAg9g.jpg';
    const tweetText = tweetData.tweetText || tweetData.text || '';
    const date = tweetData.date || '2024-12-01 23:28:41';
    const verified = tweetData.verified || false;

    const replies = formatNumber(tweetData.replies || 1);
    const reposts = formatNumber(tweetData.reposts || 0);
    const likes = formatNumber(tweetData.likes || 2900);
    const views = formatNumber(tweetData.views || 89100);

    const avatarSrc = options.useBase64 ? toBase64Uri(rawAvatarUrl) : (typeof rawAvatarUrl === 'object' ? (rawAvatarUrl.url || rawAvatarUrl.media_url_https) : rawAvatarUrl);

    const mediaList = Array.isArray(tweetData.mediaList) ? tweetData.mediaList : (tweetData.mediaUrl ? [tweetData.mediaUrl] : []);

    // First pass to compute actual freed media height
    const { mediaNode, mediaHeight } = renderFreedDimensionsMediaSection(mediaList, 0, options);

    const layout = calculateLayout(tweetText, mediaHeight);

    // Re-render mediaNode with accurate mediaY
    const { mediaNode: finalMediaNode } = renderFreedDimensionsMediaSection(mediaList, layout.mediaY, options);

    const approxNameWidth = Math.min(displayName.length * 9.5, 380);
    const verifiedX = 88 + Math.round(approxNameWidth);

    const avatarSvgNode = `
  <circle cx="48" cy="48" r="24" fill="#26292D" />
  <image href="${escapeXml(avatarSrc)}" x="24" y="24" width="48" height="48" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMin slice" />
  <circle cx="48" cy="48" r="23.5" fill="none" stroke="#2F3336" stroke-width="1" />`;

    const verifiedNode = verified ? `
  <g transform="translate(${verifiedX}, 27)">
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.19.46-1.39.02-2.93-1.09-3.83-1.1-1.1-2.64-1.55-4.03-1.09C14.42 2.58 13.18 1.7 11.75 1.7s-2.67.88-3.19 2.19c-1.39-.46-2.93-.02-3.83 1.09-1.1 1.1-1.55 2.64-1.09 4.03C2.38 9.53 1.5 10.77 1.5 12.2s.88 2.67 2.19 3.19c-.46 1.39-.02 2.93 1.09 3.83 1.1 1.1 2.64 1.55 4.03 1.09 1.04 1.31 2.28 2.19 3.71 2.19s2.67-.88 3.19-2.19c1.39.46 2.93.02 3.83-1.09 1.1-1.1 1.55-2.64 1.09-4.03 1.31-.52 2.19-1.76 2.19-3.19zm-12.71 4.29l-3.88-3.88 1.41-1.41 2.47 2.47 6.06-6.06 1.41 1.41-7.47 7.47z" fill="url(#verified-grad)" transform="scale(0.7)"/>
  </g>` : '';

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${layout.cardHeight}" width="600" height="${layout.cardHeight}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
  <defs>
    <filter id="card-shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <clipPath id="avatar-clip">
      <circle cx="48" cy="48" r="24" />
    </clipPath>

    <linearGradient id="verified-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D9BF0"/>
      <stop offset="100%" stop-color="#0077E6"/>
    </linearGradient>

    <linearGradient id="card-bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0F1419"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>

  <style>
    .card-bg { fill: url(#card-bg); stroke: #2F3336; stroke-width: 1.5; }
    .author-name { font-size: 16px; font-weight: 700; fill: #F7F9F9; }
    .author-handle { font-size: 14px; font-weight: 400; fill: #71767B; }
    .meta-text { font-size: 14px; font-weight: 400; fill: #71767B; }
    .stat-count { font-size: 13px; font-weight: 600; fill: #71767B; }
    .action-icon { fill: #71767B; }
  </style>

  <!-- Dynamic Outer Card Container (Height: ${layout.cardHeight}px) -->
  <rect x="2" y="2" width="596" height="${layout.cardHeight - 4}" rx="16" ry="16" class="card-bg" filter="url(#card-shadow)" />

  <!-- HEADER SECTION -->${avatarSvgNode}
  <text x="84" y="42" class="author-name">${escapeXml(displayName)}</text>${verifiedNode}
  <text x="84" y="62" class="author-handle">${escapeXml(handle)}</text>

  <!-- X Logo Top Right -->
  <g transform="translate(548, 28)">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#71767B"/>
  </g>

  <!-- TWEET BODY TEXT (Dynamic Height: ${layout.textHeight}px) -->
  <foreignObject x="24" y="${layout.textY}" width="552" height="${layout.textHeight}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #E7E9EA; line-height: 1.45; word-wrap: break-word; white-space: pre-wrap; margin: 0; padding: 0;">${escapeXml(tweetText)}</div>
  </foreignObject>${finalMediaNode}

  <!-- TIMESTAMP & METADATA -->
  <text x="24" y="${layout.metaY}" class="meta-text">${escapeXml(date)} · <tspan fill="#1D9BF0">Twitter for Web</tspan></text>

  <!-- DIVIDER LINE -->
  <line x1="24" y1="${layout.dividerY}" x2="576" y2="${layout.dividerY}" stroke="#2F3336" stroke-width="1"/>

  <!-- FOOTER ACTION BAR -->
  <g transform="translate(24, ${layout.actionsY})">
    <g transform="translate(0, 0)">
      <path class="action-icon" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">${replies}</text>
    </g>

    <g transform="translate(130, 0)">
      <path class="action-icon" d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">${reposts}</text>
    </g>

    <g transform="translate(260, 0)">
      <path class="action-icon" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">${likes}</text>
    </g>

    <g transform="translate(390, 0)">
      <path class="action-icon" d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" transform="scale(0.8)"/>
      <text x="24" y="14" class="stat-count">${views}</text>
    </g>

    <g transform="translate(520, 0)">
      <path class="action-icon" d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.29 3.3-1.42-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" transform="scale(0.8)"/>
    </g>
  </g>
</svg>`;

    return svgContent;
}

// Generate Freed Dimensions Test Suite (Matching User's Exact Reference Screenshots 1, 2 & 3!)
function generateFreedDimensionsTestSuite() {
    const outputDir = path.join(TWEET_DATA_DIR, 'TimeLineOutput', 'svg', 'freed_dimensions_test');
    fs.mkdirSync(outputDir, { recursive: true });

    const keerthyMediaDir = path.join(TWEET_DATA_DIR, 'Media', 'keerthi_and_etc_tweets');
    
    // Pick actual photos with different aspect ratios
    const pImg1 = path.join(keerthyMediaDir, '2026_05_15_2055186002831188500_HIV8uWHaoAAiAIV.jpg'); // 478 x 1022 (Super tall)
    const pImg2 = path.join(keerthyMediaDir, '2026_05_16_2055538989374030300_HIa9sQsbAAA_i01.jpg'); // 680 x 1000
    const pImg3 = path.join(keerthyMediaDir, '2026_05_17_2055863137803678000_HIfkcLIb0AA6qd_.jpg'); // 720 x 960
    const pImg4 = path.join(keerthyMediaDir, '2026_05_18_2056267620618576000_HIlUdaJbYAAia1n.jpg'); // 1080 x 1080

    const storyText1 = `Nenu na rendu chetulatho amma guddha ni vidadeesi naluka tho nakutunnamu...
Amma: evaru?
Dad: nene kaju
Amma: ee time lo entra lanja kodaka cheppanu kada ee roju vaddhu ani!`;

    const storyText2 = `Amma: badha padaku ra inka konni months eh kada, nuvvu ee lopu baita evaritho ayina chey kanna nenu em anukonu le...
Me: ni lanti figure ni intlo pettukoni evadina magadu baita vallani dengudam anukuntara amma!`;

    // 1. 2 IMAGES FREED DIMENSIONS (Matches User Screenshot 2 & 3!)
    const tweet2Freed = {
        displayName: "Keerthy Suresh Fan Page",
        handle: "@keerthy_and_etc",
        avatarUrl: pImg1,
        tweetText: storyText2,
        mediaList: [pImg1, pImg2],
        date: "12:45 PM · May 16, 2026",
        likes: 3420,
        views: 92400
    };

    // 2. 3 IMAGES FREED DIMENSIONS (Matches User Screenshot 1!)
    const tweet3Freed = {
        displayName: "Keerthy Suresh Fan Page",
        handle: "@keerthy_and_etc",
        avatarUrl: pImg1,
        tweetText: storyText1,
        mediaList: [pImg1, pImg2, pImg3],
        date: "1:15 PM · May 17, 2026",
        likes: 4890,
        views: 124800
    };

    // 3. 4 IMAGES FREED DIMENSIONS
    const tweet4Freed = {
        displayName: "Keerthy Suresh Fan Page",
        handle: "@keerthy_and_etc",
        avatarUrl: pImg1,
        tweetText: storyText1,
        mediaList: [pImg1, pImg2, pImg3, pImg4],
        date: "2:30 PM · May 18, 2026",
        likes: 6120,
        views: 184500
    };

    console.log(`[SVG Freed Dimensions Test] Generating SVG cards with FREED NATURAL ASPECT RATIOS...`);

    fs.writeFileSync(path.join(outputDir, 'tweet_freed_2_images.svg'), buildPerfectTweetSvg(tweet2Freed, { useBase64: true }), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'tweet_freed_3_images.svg'), buildPerfectTweetSvg(tweet3Freed, { useBase64: true }), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'tweet_freed_4_images.svg'), buildPerfectTweetSvg(tweet4Freed, { useBase64: true }), 'utf8');

    console.log(`[SVG Freed Dimensions Test] Successfully created 3 freed-dimension SVG test cards in:`);
    console.log(`  -> ${outputDir}`);
}

if (require.main === module) {
    generateFreedDimensionsTestSuite();
}

module.exports = {
    buildPerfectTweetSvg,
    calculateLayout,
    getImageDimensions
};
