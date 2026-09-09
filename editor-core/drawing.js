import { formatNumber } from './geometry.js';
function escapeXml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function renderTable(element, theme) {
    const columns = element.content?.columns || [];
    const rows = element.content?.rows || [];
    const title = element.content?.title || (element.kind === 'bom-table' ? 'BILL OF MATERIALS' : 'WIRE SCHEDULE');
    const columnCount = Math.max(1, columns.length);
    const cellWidth = element.width / columnCount;
    const titleHeight = 22;
    const rowHeight = Math.max(16, (element.height - titleHeight) / Math.max(2, rows.length + 1));
    const stroke = element.style?.stroke || theme.mutedText;
    const fill = element.style?.fill || theme.labelBackground;
    const text = element.style?.text || theme.text;
    const lines = [`<rect x="0" y="0" width="${formatNumber(element.width)}" height="${formatNumber(element.height)}" fill="${escapeXml(fill)}" fill-opacity="0.94" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/>`,
        `<text x="6" y="15" font-size="11" font-weight="700" fill="${escapeXml(text)}">${escapeXml(title)}</text>`,
        `<line x1="0" y1="${titleHeight}" x2="${formatNumber(element.width)}" y2="${titleHeight}" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/>`];
    columns.forEach((column, index) => {
        const x = index * cellWidth;
        if (index)
            lines.push(`<line x1="${formatNumber(x)}" y1="${titleHeight}" x2="${formatNumber(x)}" y2="${formatNumber(element.height)}" stroke="${escapeXml(stroke)}" stroke-opacity="0.55" vector-effect="non-scaling-stroke"/>`);
        lines.push(`<text x="${formatNumber(x + 5)}" y="${formatNumber(titleHeight + rowHeight * 0.7)}" font-size="9" font-weight="650" fill="${escapeXml(text)}">${escapeXml(column)}</text>`);
    });
    rows.slice(0, Math.max(0, Math.floor((element.height - titleHeight) / rowHeight) - 1)).forEach((row, rowIndex) => {
        const y = titleHeight + rowHeight * (rowIndex + 1);
        lines.push(`<line x1="0" y1="${formatNumber(y)}" x2="${formatNumber(element.width)}" y2="${formatNumber(y)}" stroke="${escapeXml(stroke)}" stroke-opacity="0.35" vector-effect="non-scaling-stroke"/>`);
        row.slice(0, columnCount).forEach((value, columnIndex) => lines.push(`<text x="${formatNumber(columnIndex * cellWidth + 5)}" y="${formatNumber(y + rowHeight * 0.7)}" font-size="8.5" fill="${escapeXml(text)}">${escapeXml(value)}</text>`));
    });
    return lines.join('');
}
export function renderDrawingElements(elements, theme) {
    if (!elements?.length)
        return '';
    return elements.map((element) => {
        const stroke = element.style?.stroke || theme.mutedText;
        const fill = element.style?.fill || theme.labelBackground;
        const text = element.style?.text || theme.text;
        const transform = `translate(${formatNumber(element.x)} ${formatNumber(element.y)}) rotate(${formatNumber(element.rotation || 0)})`;
        let content = '';
        if (element.kind === 'dimension') {
            const y = element.height / 2;
            content = `<path d="M0 ${formatNumber(y - 7)}V${formatNumber(y + 7)}M${formatNumber(element.width)} ${formatNumber(y - 7)}V${formatNumber(y + 7)}M0 ${formatNumber(y)}H${formatNumber(element.width)}" fill="none" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/><path d="M0 ${formatNumber(y)}l8 -4v8zM${formatNumber(element.width)} ${formatNumber(y)}l-8 -4v8z" fill="${escapeXml(stroke)}"/><text x="${formatNumber(element.width / 2)}" y="${formatNumber(y - 6)}" text-anchor="middle" font-size="10" fill="${escapeXml(text)}">${escapeXml(element.content?.value || element.content?.text || `${formatNumber(element.width)} mm`)}</text>`;
        }
        else if (element.kind === 'leader-note') {
            const leaderX = Number(element.content?.leaderX ?? -35);
            const leaderY = Number(element.content?.leaderY ?? element.height + 25);
            content = `<path d="M${formatNumber(leaderX)} ${formatNumber(leaderY)}L0 ${formatNumber(element.height / 2)}" fill="none" stroke="${escapeXml(stroke)}" marker-start="url(#editor-core-drawing-arrow)" vector-effect="non-scaling-stroke"/><rect width="${formatNumber(element.width)}" height="${formatNumber(element.height)}" rx="3" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/><text x="7" y="${formatNumber(element.height / 2 + 4)}" font-size="${formatNumber(element.style?.fontSize || 10)}" fill="${escapeXml(text)}">${escapeXml(element.content?.text || 'Manufacturing note')}</text>`;
        }
        else if (element.kind === 'title-block') {
            content = `<rect width="${formatNumber(element.width)}" height="${formatNumber(element.height)}" fill="${escapeXml(fill)}" fill-opacity="0.94" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/><line x1="0" y1="28" x2="${formatNumber(element.width)}" y2="28" stroke="${escapeXml(stroke)}" vector-effect="non-scaling-stroke"/><text x="8" y="19" font-size="12" font-weight="700" fill="${escapeXml(text)}">${escapeXml(element.content?.title || 'ASSEMBLY DRAWING')}</text><text x="8" y="45" font-size="9" fill="${escapeXml(text)}">${escapeXml(element.content?.text || 'Draft · Not released')}</text>`;
        }
        else {
            content = renderTable(element, theme);
        }
        return `<g class="editor-core-drawing-element" data-drawing-id="${escapeXml(element.id)}" data-drawing-kind="${escapeXml(element.kind)}" transform="${transform}">${content}</g>`;
    }).join('\n');
}
//# sourceMappingURL=drawing.js.map