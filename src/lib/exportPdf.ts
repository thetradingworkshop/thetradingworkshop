import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// Session Detail's "Export PDF" — client-side only (no server involvement).
// Captures the exportable DOM region as a raster image via html2canvas,
// then slices that single tall image across as many jsPDF pages as needed.
// This is a direct-capture approach (no separate print-optimized layout):
// the caller passes a ref around only the exportable content, with nav/
// buttons/date-pickers left as siblings outside it, so they're naturally
// excluded without a second layout to maintain.
export async function exportSessionPdf(el: HTMLElement, meta: { dateRangeLabel: string; accountLabel?: string }): Promise<void> {
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    useCORS: true,
    // Tailwind v4's color-mix()/oklch()-based palette (every bg-X/10,
    // border-X/20 opacity-modifier utility throughout this app) resolves,
    // in current Chrome, to a computed `color(oklab ...)` string that
    // html2canvas's own regex-based CSS color parser can't read
    // ("Attempting to parse an unsupported color function") — confirmed
    // by hand against this exact screen. foreignObjectRendering hands the
    // actual rasterization to the browser's native SVG <foreignObject>
    // path instead, which resolves those colors itself, sidestepping
    // html2canvas's parser entirely.
    foreignObjectRendering: true,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;

  // Header — session date range/account, generated timestamp.
  pdf.setFontSize(14);
  pdf.text('Trading Workshop — Session Report', margin, margin + 4);
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  const headerLine = [meta.dateRangeLabel, meta.accountLabel].filter(Boolean).join(' — ');
  pdf.text(headerLine, margin, margin + 20);
  pdf.text(`Generated ${new Date().toLocaleString()}`, margin, margin + 33);
  pdf.setTextColor(0);

  const contentTop = margin + 48;
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL('image/png');

  // Standard html2canvas+jsPDF pagination recipe: draw the same full-height
  // image on each page, shifted up by however much has already been shown,
  // clipped to that page's remaining content area.
  let heightLeft = imgHeight;
  let position = contentTop;
  const firstPageContentHeight = pageHeight - contentTop - margin;

  pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
  heightLeft -= firstPageContentHeight;

  while (heightLeft > 0) {
    position = -(imgHeight - heightLeft) + margin;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - margin * 2);
  }

  const fileSafeLabel = meta.dateRangeLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  pdf.save(`session-${fileSafeLabel}.pdf`);
}
