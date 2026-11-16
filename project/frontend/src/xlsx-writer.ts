// A small writer for formatted Excel (.xlsx) reports.
//
// The "xlsx" package used by the import wizard can read and write workbooks
// but cannot style them or add charts. This writer produces a workbook with
// styled cells, number formats, merged cells, formulas, in-cell data bars,
// colour scales, native Excel charts and print settings, with no dependency.
//
// An .xlsx file is a ZIP archive of XML parts; both are written here by hand.

export interface CellStyle {
  bold?: boolean;
  /** Font size in points. Default 10. */
  size?: number;
  /** Text colour, RRGGBB. */
  color?: string;
  /** Background colour, RRGGBB. */
  fill?: string;
  /** Thin border on all four sides. */
  border?: boolean;
  /** Excel number format, e.g. "#,##0" or "0.0%". */
  format?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "center" | "bottom";
  wrap?: boolean;
  indent?: number;
}

export interface Cell {
  /** The value, or for a formula cell the value it evaluates to. */
  value?: string | number;
  /** Excel formula without the leading "=". Excel recalculates it on open. */
  formula?: string;
  style?: CellStyle;
}

export type ConditionalFormat =
  | { type: "dataBar"; ref: string; color: string }
  | { type: "colorScale"; ref: string; from: string; to: string };

export interface Chart {
  type: "line" | "column" | "bar";
  title: string;
  /** Top-left corner, as zero-based column and row. */
  anchor: { col: number; row: number };
  /** Size in centimetres. */
  width: number;
  height: number;
  /** Cell ranges such as 'Sales over time'!$A$2:$A$37 (use rangeRef). */
  categories: string;
  values: string;
  /** Number format for the value axis. */
  valueFormat?: string;
  /** Set when the categories are dates stored as numbers. */
  categoryFormat?: string;
  /** Show only every n-th category label. */
  labelSkip?: number;
}

export interface Sheet {
  name: string;
  /** rows[r][c]; leave a cell undefined to keep it empty. */
  rows: (Cell | undefined)[][];
  /** Column widths in characters. */
  widths: number[];
  /** Row heights in points, keyed by zero-based row index. */
  rowHeights?: Record<number, number>;
  /** Ranges to merge, e.g. "B5:C5". */
  merges?: string[];
  frozenRows?: number;
  conditionalFormats?: ConditionalFormat[];
  charts?: Chart[];
  /** Repeat the first row on every printed page. */
  repeatHeaderRow?: boolean;
  orientation?: "portrait" | "landscape";
  /** Squeeze the whole sheet onto one printed page (otherwise only the width is fitted). */
  fitOnOnePage?: boolean;
}

const FONT_NAME = "Arial";
const DEFAULT_SIZE = 10;
const INK = "18271D";
const BORDER_COLOR = "DCE3D8";
const CHART_COLOR = "5F7F4E";
const GRIDLINE_COLOR = "E3E8E0";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_NS = "http://schemas.openxmlformats.org/package/2006";
const CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const SHEET_DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

export function escapeXml(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // control characters XML cannot hold
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** Zero-based column and row to an address such as "B6". */
export function cellRef(col: number, row: number): string {
  return `${columnLetters(col)}${row + 1}`;
}

/** A sheet name as it must appear inside a formula. */
export function sheetRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** Absolute range on another sheet, for charts: 'Name'!$A$2:$A$37 */
export function rangeRef(sheet: string, col: number, firstRow: number, lastRow: number): string {
  const letters = columnLetters(col);
  return `${sheetRef(sheet)}!$${letters}$${firstRow + 1}:$${letters}$${lastRow + 1}`;
}

/** Excel's day number for a calendar date (YYYY-MM-DD). */
export function excelDate(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Styles: every distinct CellStyle becomes one entry in styles.xml
// ---------------------------------------------------------------------------

class StyleRegistry {
  private fonts = new Map<string, number>();
  private fills = new Map<string, number>();
  private formats = new Map<string, number>();
  private xfs = new Map<string, number>();
  private fontXml: string[] = [];
  private fillXml: string[] = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
  ];
  private formatXml: string[] = [];
  private xfXml: string[] = [];

  constructor() {
    this.id({}); // index 0: the default cell style
  }

  private intern(map: Map<string, number>, list: string[], key: string, xml: string, offset = 0): number {
    let index = map.get(key);
    if (index === undefined) {
      index = list.length + offset;
      map.set(key, index);
      list.push(xml);
    }
    return index;
  }

  id(style: CellStyle): number {
    const size = style.size ?? DEFAULT_SIZE;
    const color = style.color ?? INK;
    const font = this.intern(
      this.fonts,
      this.fontXml,
      `${style.bold ? 1 : 0}|${size}|${color}`,
      `<font>${style.bold ? "<b/>" : ""}<sz val="${size}"/><color rgb="FF${color}"/><name val="${FONT_NAME}"/></font>`,
    );
    const fill = style.fill
      ? this.intern(
          this.fills,
          this.fillXml,
          style.fill,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/></patternFill></fill>`,
        )
      : 0;
    // Custom number formats start at id 164.
    const format = style.format
      ? this.intern(
          this.formats,
          this.formatXml,
          style.format,
          `<numFmt numFmtId="${164 + this.formatXml.length}" formatCode="${escapeXml(style.format)}"/>`,
          164,
        )
      : 0;
    const border = style.border ? 1 : 0;
    const alignment =
      style.align || style.valign || style.wrap || style.indent
        ? `<alignment${style.align ? ` horizontal="${style.align}"` : ""}${
            style.valign ? ` vertical="${style.valign}"` : ""
          }${style.wrap ? ` wrapText="1"` : ""}${style.indent ? ` indent="${style.indent}"` : ""}/>`
        : "";
    const attributes =
      `numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      ` applyFont="1"${format ? ` applyNumberFormat="1"` : ""}${fill ? ` applyFill="1"` : ""}` +
      `${border ? ` applyBorder="1"` : ""}${alignment ? ` applyAlignment="1"` : ""}`;
    return this.intern(
      this.xfs,
      this.xfXml,
      attributes + alignment,
      alignment ? `<xf ${attributes}>${alignment}</xf>` : `<xf ${attributes}/>`,
    );
  }

  xml(): string {
    const sides = ["left", "right", "top", "bottom"]
      .map((side) => `<${side} style="thin"><color rgb="FF${BORDER_COLOR}"/></${side}>`)
      .join("");
    return (
      `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
      (this.formatXml.length
        ? `<numFmts count="${this.formatXml.length}">${this.formatXml.join("")}</numFmts>`
        : "") +
      `<fonts count="${this.fontXml.length}">${this.fontXml.join("")}</fonts>` +
      `<fills count="${this.fillXml.length}">${this.fillXml.join("")}</fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border>${sides}<diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfXml.length}">${this.xfXml.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

// ---------------------------------------------------------------------------
// Worksheets
// ---------------------------------------------------------------------------

function sheetXml(sheet: Sheet, styles: StyleRegistry, drawingRelId: string | null): string {
  const columnCount = Math.max(1, sheet.widths.length, ...sheet.rows.map((row) => row.length));
  const lastCell = cellRef(columnCount - 1, Math.max(0, sheet.rows.length - 1));

  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, column) => {
          if (!cell) return "";
          const ref = cellRef(column, rowIndex);
          const style = ` s="${styles.id(cell.style ?? {})}"`;
          const formula = cell.formula ? `<f>${escapeXml(cell.formula)}</f>` : "";
          if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
            return `<c r="${ref}"${style}>${formula}<v>${cell.value}</v></c>`;
          }
          if (typeof cell.value === "string" && (cell.value !== "" || formula)) {
            return formula
              ? `<c r="${ref}"${style} t="str">${formula}<v>${escapeXml(cell.value)}</v></c>`
              : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
          }
          return `<c r="${ref}"${style}>${formula}</c>`;
        })
        .join("");
      const height = sheet.rowHeights?.[rowIndex];
      return cells || height
        ? `<row r="${rowIndex + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`
        : "";
    })
    .join("");

  const frozen = sheet.frozenRows ?? 0;
  const pane = frozen
    ? `<pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft"/>`
    : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join("")}</mergeCells>`
    : "";
  const conditional = (sheet.conditionalFormats ?? [])
    .map((rule, index) => {
      const body =
        rule.type === "dataBar"
          ? `<dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="FF${rule.color}"/></dataBar>`
          : `<colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FF${rule.from}"/><color rgb="FF${rule.to}"/></colorScale>`;
      return (
        `<conditionalFormatting sqref="${rule.ref}">` +
        `<cfRule type="${rule.type}" priority="${index + 1}">${body}</cfRule></conditionalFormatting>`
      );
    })
    .join("");

  return (
    `${XML_HEAD}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${lastCell}"/>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${sheet.widths
      .map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`)
      .join("")}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    merges +
    conditional +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="${sheet.orientation ?? "landscape"}" fitToWidth="1" fitToHeight="${
      sheet.fitOnOnePage ? 1 : 0
    }"/>` +
    `<headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>` +
    (drawingRelId ? `<drawing r:id="${drawingRelId}"/>` : "") +
    `</worksheet>`
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function chartXml(chart: Chart): string {
  const horizontal = chart.type === "bar";
  const line = chart.type === "line";
  const fillXml = `<a:solidFill><a:srgbClr val="${CHART_COLOR}"/></a:solidFill>`;
  const shape = line
    ? `<c:spPr><a:ln w="22225">${fillXml}<a:prstDash val="solid"/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
    : `<c:spPr>${fillXml}</c:spPr>`;
  const categories = chart.categoryFormat
    ? `<c:numRef><c:f>${escapeXml(chart.categories)}</c:f></c:numRef>`
    : `<c:strRef><c:f>${escapeXml(chart.categories)}</c:f></c:strRef>`;
  const series =
    `<c:ser><c:idx val="0"/><c:order val="0"/>${shape}` +
    `<c:cat>${categories}</c:cat>` +
    `<c:val><c:numRef><c:f>${escapeXml(chart.values)}</c:f></c:numRef></c:val>` +
    (line ? `<c:smooth val="0"/>` : "") +
    `</c:ser>`;
  const plot = line
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:axId val="10"/><c:axId val="100"/></c:lineChart>`
    : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
      `${series}<c:gapWidth val="60"/><c:axId val="10"/><c:axId val="100"/></c:barChart>`;
  const text = (size: number, bold = false) =>
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}">` +
    `<a:latin typeface="${FONT_NAME}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

  return (
    `${XML_HEAD}<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${DRAWING_NS}" xmlns:r="${REL_NS}">` +
    `<c:roundedCorners val="0"/>` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1">` +
    `<a:latin typeface="${FONT_NAME}"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1">` +
    `<a:latin typeface="${FONT_NAME}"/></a:rPr><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx>` +
    `<c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>${plot}` +
    // Category axis. A horizontal bar chart lists its first category at the top.
    `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/>` +
    (chart.categoryFormat
      ? `<c:numFmt formatCode="${escapeXml(chart.categoryFormat)}" sourceLinked="0"/>`
      : "") +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text(800)}` +
    `<c:crossAx val="100"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>` +
    (chart.labelSkip ? `<c:tickLblSkip val="${chart.labelSkip}"/>` : "") +
    `<c:noMultiLvlLbl val="0"/></c:catAx>` +
    // Value axis: always starts at zero so bars can be compared fairly.
    `<c:valAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? "t" : "l"}"/>` +
    `<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="${GRIDLINE_COLOR}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    `<c:numFmt formatCode="${escapeXml(chart.valueFormat ?? "#,##0")}" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text(800)}` +
    `<c:crossAx val="10"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>` +
    `</c:plotArea>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
    `</c:chart>` +
    `</c:chartSpace>`
  );
}

function drawingXml(charts: Chart[]): string {
  const EMU_PER_CM = 360_000;
  return (
    `${XML_HEAD}<xdr:wsDr xmlns:xdr="${SHEET_DRAWING_NS}" xmlns:a="${DRAWING_NS}">` +
    charts
      .map(
        (chart, index) =>
          `<xdr:oneCellAnchor>` +
          `<xdr:from><xdr:col>${chart.anchor.col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
          `<xdr:row>${chart.anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${Math.round(chart.width * EMU_PER_CM)}" cy="${Math.round(chart.height * EMU_PER_CM)}"/>` +
          `<xdr:graphicFrame macro="">` +
          `<xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
          `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
          `<a:graphic><a:graphicData uri="${CHART_NS}">` +
          `<c:chart xmlns:c="${CHART_NS}" xmlns:r="${REL_NS}" r:id="rId${index + 1}"/>` +
          `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`,
      )
      .join("") +
    `</xdr:wsDr>`
  );
}

/** Excel sheet names: at most 31 characters, none of \ / ? * [ ] : and unique. */
export function cleanSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((original, index) => {
    const base = original.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------------------------------------------------------------------------
// ZIP container (stored, i.e. not compressed)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { path: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const entries = files.map((file) => {
    const data = encoder.encode(file.content);
    return { name: encoder.encode(file.path), data, crc: crc32(data), offset: 0 };
  });
  const bodySize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const directorySize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(bodySize + directorySize + 22);
  const view = new DataView(output.buffer);
  let position = 0;

  const sharedHeader = (entry: (typeof entries)[number]) => {
    view.setUint16(position, 20, true); // version needed
    view.setUint16(position + 2, 0x0800, true); // UTF-8 names
    view.setUint16(position + 4, 0, true); // stored
    view.setUint16(position + 6, dosTime, true);
    view.setUint16(position + 8, dosDate, true);
    view.setUint32(position + 10, entry.crc, true);
    view.setUint32(position + 14, entry.data.length, true);
    view.setUint32(position + 18, entry.data.length, true);
    view.setUint16(position + 22, entry.name.length, true);
    view.setUint16(position + 24, 0, true); // extra length
    position += 26;
  };

  for (const entry of entries) {
    entry.offset = position;
    view.setUint32(position, 0x04034b50, true);
    position += 4;
    sharedHeader(entry);
    output.set(entry.name, position);
    position += entry.name.length;
    output.set(entry.data, position);
    position += entry.data.length;
  }

  const directoryStart = position;
  for (const entry of entries) {
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true); // version made by
    position += 6;
    sharedHeader(entry);
    // comment length, disk number, internal attrs (2 bytes each), external attrs (4)
    position += 10;
    view.setUint32(position, entry.offset, true);
    position += 4;
    output.set(entry.name, position);
    position += entry.name.length;
  }

  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, entries.length, true);
  view.setUint16(position + 10, entries.length, true);
  view.setUint32(position + 12, position - directoryStart, true);
  view.setUint32(position + 16, directoryStart, true);
  return output;
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/** Build the bytes of a formatted .xlsx workbook. Sheet names must already be valid and unique. */
export function writeWorkbook(sheets: Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet");
  const styles = new StyleRegistry();
  const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  const files: { path: string; content: string }[] = [];
  const overrides: string[] = [];
  let chartCount = 0;
  let drawingCount = 0;

  sheets.forEach((sheet, index) => {
    const number = index + 1;
    const charts = sheet.charts ?? [];
    let drawingRelId: string | null = null;

    if (charts.length > 0) {
      drawingCount += 1;
      drawingRelId = "rId1";
      const chartNumbers = charts.map(() => (chartCount += 1));
      files.push({ path: `xl/drawings/drawing${drawingCount}.xml`, content: drawingXml(charts) });
      files.push({
        path: `xl/drawings/_rels/drawing${drawingCount}.xml.rels`,
        content:
          `${XML_HEAD}<Relationships xmlns="${PKG_NS}/relationships">` +
          chartNumbers
            .map(
              (chartNumber, position) =>
                `<Relationship Id="rId${position + 1}" Type="${REL_NS}/chart" Target="../charts/chart${chartNumber}.xml"/>`,
            )
            .join("") +
          `</Relationships>`,
      });
      charts.forEach((chart, position) => {
        files.push({ path: `xl/charts/chart${chartNumbers[position]}.xml`, content: chartXml(chart) });
        overrides.push(
          `<Override PartName="/xl/charts/chart${chartNumbers[position]}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        );
      });
      files.push({
        path: `xl/worksheets/_rels/sheet${number}.xml.rels`,
        content:
          `${XML_HEAD}<Relationships xmlns="${PKG_NS}/relationships">` +
          `<Relationship Id="rId1" Type="${REL_NS}/drawing" Target="../drawings/drawing${drawingCount}.xml"/>` +
          `</Relationships>`,
      });
      overrides.push(
        `<Override PartName="/xl/drawings/drawing${drawingCount}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
    }

    files.push({
      path: `xl/worksheets/sheet${number}.xml`,
      content: sheetXml(sheet, styles, drawingRelId),
    });
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${number}.xml" ContentType="${sheetType}.worksheet+xml"/>`,
    );
  });

  const printTitles = sheets
    .map((sheet, index) =>
      sheet.repeatHeaderRow
        ? `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(sheetRef(sheet.name))}!$1:$1</definedName>`
        : "",
    )
    .join("");

  return zip([
    {
      path: "[Content_Types].xml",
      content:
        `${XML_HEAD}<Types xmlns="${PKG_NS}/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="${sheetType}.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${sheetType}.styles+xml"/>` +
        overrides.join("") +
        `</Types>`,
    },
    {
      path: "_rels/.rels",
      content:
        `${XML_HEAD}<Relationships xmlns="${PKG_NS}/relationships">` +
        `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content:
        `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
        `<sheets>` +
        sheets
          .map(
            (sheet, index) =>
              `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
          .join("") +
        `</sheets>` +
        (printTitles ? `<definedNames>${printTitles}</definedNames>` : "") +
        // Formulas carry their computed values; this makes Excel refresh them on open.
        `<calcPr fullCalcOnLoad="1"/>` +
        `</workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content:
        `${XML_HEAD}<Relationships xmlns="${PKG_NS}/relationships">` +
        sheets
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { path: "xl/styles.xml", content: styles.xml() },
    ...files,
  ]);
}
