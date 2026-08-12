// Builds downloadable ID card PDFs — one page per employee, front card image
// on the upper half of the page and back on the lower half, both placed at
// their real physical CR80 size (85.6mm x 54mm landscape, or 54mm x 85.6mm
// portrait) so printing the PDF at 100% scale produces correctly-sized
// cards, matching the dedicated single-card print flow.
//
// Requires shared/jspdf-lib.js to already be loaded as a plain <script> tag
// (sets window.jspdf) — this module doesn't import it, since jsPDF ships as
// a UMD global, not an ES module export.

const PAGE_W = 210, PAGE_H = 297; // A4, mm

function cardDims(orientation) {
  return orientation === "portrait" ? { w: 54, h: 85.6 } : { w: 85.6, h: 54 };
}

function addCardPage(doc, { front, back, label }, orientation, isFirst) {
  if (!isFirst) doc.addPage();
  const { w, h } = cardDims(orientation);
  const x = (PAGE_W - w) / 2;

  if (label) {
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text(label, PAGE_W / 2, 16, { align: "center" });
  }

  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text("FRONT", PAGE_W / 2, 25, { align: "center" });
  doc.addImage(front, "PNG", x, 28, w, h);

  const backLabelY = 28 + h + 15;
  doc.text("BACK", PAGE_W / 2, backLabelY, { align: "center" });
  doc.addImage(back, "PNG", x, backLabelY + 3, w, h);
}

/** cards: [{ front, back, label }] — front/back are PNG data: URLs
 *  (e.g. from renderCardImagePair). Returns a jsPDF document instance. */
export function buildCardsPdf(cards, orientation) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  cards.forEach((card, i) => addCardPage(doc, card, orientation, i === 0));
  return doc;
}

export function downloadCardsPdf(cards, orientation, filename) {
  buildCardsPdf(cards, orientation).save(filename);
}
