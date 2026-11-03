/**
 * Print & PDF Export Utility Helpers for DialisisLog
 * Standardized for KARS & PERNEFRI accreditation documentation.
 * Supports:
 * 1. "Cetak": Langsung membuka dialog cetak browser (window.print)
 * 2. "Simpan PDF": Langsung mendownload file dokumen PDF ke perangkat pengguna (html-to-image + jsPDF)
 *    Mendukung penuh warna modern Tailwind CSS v4 (oklab, oklch) tanpa crash.
 */

import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

export interface PrintOptions {
  isLandscape?: boolean;
  documentTitle?: string;
  isModal?: boolean;
}

export interface DownloadPdfOptions {
  filename?: string;
  isLandscape?: boolean;
  scale?: number;
  marginMm?: number;
  targetWidthPx?: number;
  fitToSinglePage?: boolean;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * FUNGSI CETAK: Langsung membuka dialog cetak browser (window.print)
 * dengan orientasi Portrait atau Landscape standar kertas A4 KARS & PERNEFRI.
 */
export function printDocumentWithOrientation(
  isLandscape: boolean = false,
  documentTitle?: string,
  isModal: boolean = false
): void {
  if (typeof window === 'undefined') return;

  const styleId = 'dialysis-print-orientation-style';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  // Dynamic @page size and margins
  styleEl.innerHTML = `
    @page {
      size: A4 ${isLandscape ? 'landscape' : 'portrait'} !important;
      margin: ${isLandscape ? '5mm 4mm' : '7mm 6mm'} !important;
    }
  `;

  // Apply printing helper classes to body
  const bodyClasses = document.body.classList;
  bodyClasses.add('dialysis-printing');
  if (isLandscape) {
    bodyClasses.add('dialysis-landscape');
    bodyClasses.remove('dialysis-portrait');
  } else {
    bodyClasses.add('dialysis-portrait');
    bodyClasses.remove('dialysis-landscape');
  }

  if (isModal) {
    bodyClasses.add('dialysis-modal-printing');
  }

  // Save current title and temporarily set custom title for suggested PDF file name in browser
  const originalTitle = document.title;
  if (documentTitle) {
    const sanitizedTitle = documentTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .trim();
    document.title = sanitizedTitle;
  }

  const cleanup = () => {
    bodyClasses.remove('dialysis-printing', 'dialysis-landscape', 'dialysis-portrait', 'dialysis-modal-printing');
    if (documentTitle) {
      document.title = originalTitle;
    }
    const el = document.getElementById(styleId);
    if (el) el.remove();
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });

  // Use requestAnimationFrame to ensure all DOM updates and layout reflows complete before print dialog
  requestAnimationFrame(() => {
    setTimeout(() => {
      let isBlocked = false;
      try {
        window.focus();
        window.print();
        if (isRunningInIframe()) {
          window.dispatchEvent(
            new CustomEvent('dialysis_print_in_iframe_attempted', {
              detail: { documentTitle }
            })
          );
        }
      } catch (err) {
        isBlocked = true;
        console.warn('Print trigger blocked or failed:', err);
        cleanup();
        window.dispatchEvent(
          new CustomEvent('dialysis_print_blocked', {
            detail: {
              error: err instanceof Error ? err.message : String(err),
              documentTitle
            }
          })
        );
      }
      if (!isBlocked) {
        setTimeout(cleanup, 4000);
      }
    }, 80);
  });
}

interface SavedDomStyle {
  el: HTMLElement;
  width: string;
  minWidth: string;
  maxWidth: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
  maxHeight: string;
}

/**
 * FUNGSI SIMPAN PDF: Langsung mendownload file .pdf ke perangkat pengguna.
 * Menangani secara otomatis elemen bertabel lebar (misal 30 kolom pada Laporan Pasien HD),
 * membuka scroll container yang terpotong secara virtual saat rendering sehingga seluruh
 * kolom dari awal hingga akhir tercakup lengkap tanpa terpotong.
 */
export async function downloadElementAsPdf(
  elementIdOrElement: string | HTMLElement,
  options: DownloadPdfOptions = {}
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const {
    filename = 'Dokumen_Hemodialisis',
    isLandscape = false,
    scale = 2,
    marginMm = 4,
    targetWidthPx,
    fitToSinglePage = false
  } = options;

  const targetEl =
    typeof elementIdOrElement === 'string'
      ? document.getElementById(elementIdOrElement)
      : elementIdOrElement;

  if (!targetEl) {
    console.warn(`[downloadElementAsPdf] Target element not found:`, elementIdOrElement);
    return false;
  }

  // Detect tables and potential horizontal scroll overflow
  const tables = Array.from(targetEl.querySelectorAll<HTMLTableElement>('table'));
  const scrollContainers = Array.from(
    targetEl.querySelectorAll<HTMLElement>(
      '.overflow-x-auto, [class*="overflow-x-"], .overflow-auto'
    )
  );

  let maxContentWidth = targetEl.scrollWidth;
  tables.forEach((tbl) => {
    maxContentWidth = Math.max(maxContentWidth, tbl.scrollWidth, tbl.offsetWidth);
  });
  scrollContainers.forEach((sc) => {
    maxContentWidth = Math.max(maxContentWidth, sc.scrollWidth);
  });

  if (typeof targetWidthPx === 'number' && targetWidthPx > 0) {
    maxContentWidth = Math.max(maxContentWidth, targetWidthPx);
  }

  // If this is a very wide table or explicitly requested width, expand all clipped containers
  const isWideContent =
    maxContentWidth > targetEl.clientWidth || (targetWidthPx && targetWidthPx > 0);

  const savedStyles: SavedDomStyle[] = [];

  const recordAndSetStyle = (
    el: HTMLElement,
    overrides: Partial<CSSStyleDeclaration>
  ) => {
    savedStyles.push({
      el,
      width: el.style.width,
      minWidth: el.style.minWidth,
      maxWidth: el.style.maxWidth,
      overflow: el.style.overflow,
      overflowX: el.style.overflowX,
      overflowY: el.style.overflowY,
      maxHeight: el.style.maxHeight
    });
    Object.assign(el.style, overrides);
  };

  try {
    document.body.classList.add('dialysis-pdf-exporting');
    targetEl.classList.add('dialysis-pdf-exporting');

    if (isWideContent) {
      recordAndSetStyle(targetEl, {
        width: `${maxContentWidth}px`,
        minWidth: `${maxContentWidth}px`,
        maxWidth: 'none',
        overflow: 'visible',
        maxHeight: 'none'
      });

      scrollContainers.forEach((sc) => {
        recordAndSetStyle(sc, {
          overflow: 'visible',
          overflowX: 'visible',
          width: '100%',
          minWidth: `${maxContentWidth}px`,
          maxWidth: 'none'
        });
      });

      tables.forEach((tbl) => {
        recordAndSetStyle(tbl, {
          width: '100%',
          minWidth: `${maxContentWidth}px`,
          tableLayout: 'auto'
        });
      });
    } else {
      recordAndSetStyle(targetEl, {
        overflow: 'visible',
        maxHeight: 'none'
      });
    }

    // Let the DOM reflow to layout all columns cleanly
    await new Promise((r) => setTimeout(r, 60));

    const exportWidth = targetEl.scrollWidth || maxContentWidth;
    const exportHeight = targetEl.scrollHeight;

    // Generate high-resolution JPEG data URL via native SVG foreignObject
    const dataUrl = await toJpeg(targetEl, {
      quality: 0.96,
      pixelRatio: Math.max(1.5, Math.min(scale, 2.5)),
      backgroundColor: '#ffffff',
      width: exportWidth,
      height: exportHeight,
      canvasWidth: Math.round(exportWidth * Math.max(1.5, Math.min(scale, 2.5))),
      canvasHeight: Math.round(exportHeight * Math.max(1.5, Math.min(scale, 2.5))),
      cacheBust: false,
      skipFonts: true,
      fontEmbedCSS: '',
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (
            node.classList.contains('print:hidden') ||
            node.classList.contains('modal-toolbar') ||
            node.getAttribute('data-pdf-ignore') === 'true'
          ) {
            return false;
          }
        }
        return true;
      }
    });

    // Load into Image to extract actual rendered pixel dimensions
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load generated image into memory'));
    });

    const orientation = isLandscape ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = isLandscape ? 297 : 210;
    const pageHeight = isLandscape ? 210 : 297;
    const usableWidth = pageWidth - marginMm * 2;
    const usableHeight = pageHeight - marginMm * 2;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    // Height when scaled proportionally to fit usableWidth
    const scaledHeight = (naturalHeight * usableWidth) / naturalWidth;

    if (scaledHeight <= usableHeight) {
      // Single page document: perfect fit
      pdf.addImage(dataUrl, 'JPEG', marginMm, marginMm, usableWidth, scaledHeight, undefined, 'FAST');
    } else if (fitToSinglePage || scaledHeight <= usableHeight * 1.15) {
      // Proportional fit to single page for standard clinical tables
      const fitScale = usableHeight / scaledHeight;
      const fitWidth = usableWidth * fitScale;
      const fitHeight = usableHeight;
      const offsetX = marginMm + (usableWidth - fitWidth) / 2;
      pdf.addImage(dataUrl, 'JPEG', offsetX, marginMm, fitWidth, fitHeight, undefined, 'FAST');
    } else {
      // Clean canvas slice pagination without bleeding into page margins
      const sliceHeightPx = Math.floor(naturalWidth * (usableHeight / usableWidth));
      let remainingHeightPx = naturalHeight;
      let sourceYPx = 0;
      let pageNum = 1;

      while (remainingHeightPx > 0) {
        if (pageNum > 1) {
          pdf.addPage('a4', orientation);
        }

        const currentSliceHeightPx = Math.min(remainingHeightPx, sliceHeightPx);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = naturalWidth;
        sliceCanvas.height = currentSliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, naturalWidth, currentSliceHeightPx);
          ctx.drawImage(
            img,
            0,
            sourceYPx,
            naturalWidth,
            currentSliceHeightPx,
            0,
            0,
            naturalWidth,
            currentSliceHeightPx
          );
          const sliceDataUrl = sliceCanvas.toDataURL('image/jpeg', 0.96);
          const renderedHeightMm = (currentSliceHeightPx * usableWidth) / naturalWidth;
          pdf.addImage(
            sliceDataUrl,
            'JPEG',
            marginMm,
            marginMm,
            usableWidth,
            renderedHeightMm,
            undefined,
            'FAST'
          );
        }

        sourceYPx += currentSliceHeightPx;
        remainingHeightPx -= currentSliceHeightPx;
        pageNum++;
      }
    }

    const cleanName =
      filename
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/\.pdf$/i, '') + '.pdf';

    pdf.save(cleanName);
    return true;
  } catch (err) {
    console.error('[downloadElementAsPdf] PDF generation failed:', err);
    throw err;
  } finally {
    // Restore all original styles cleanly
    savedStyles.forEach((s) => {
      s.el.style.width = s.width;
      s.el.style.minWidth = s.minWidth;
      s.el.style.maxWidth = s.maxWidth;
      s.el.style.overflow = s.overflow;
      s.el.style.overflowX = s.overflowX;
      s.el.style.overflowY = s.overflowY;
      s.el.style.maxHeight = s.maxHeight;
    });
    document.body.classList.remove('dialysis-pdf-exporting');
    targetEl.classList.remove('dialysis-pdf-exporting');
  }
}
