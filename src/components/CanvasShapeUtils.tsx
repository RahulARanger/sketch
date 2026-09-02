import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { ExternalLink, ImageOff, Plus, Trash2 } from "lucide-react";
import { BaseBoxShapeUtil, HTMLContainer, Rectangle2d, T, useEditor, type RecordProps, type TLBaseShape } from "tldraw";

export const TABLE_SHAPE_TYPE = "table" as const;
export const LINK_SHAPE_TYPE = "bosketch-link" as const;
export const IMAGE_SHAPE_TYPE = "bosketch-image" as const;

export type TableShapeProps = { w: number; h: number; rows: string[][] };
export type LinkShapeProps = { w: number; h: number; url: string; label: string };
export type ImageShapeProps = { w: number; h: number; src: string; alt: string };

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    table: TableShapeProps;
    "bosketch-link": LinkShapeProps;
    "bosketch-image": ImageShapeProps;
  }
}

export type TableShape = TLBaseShape<typeof TABLE_SHAPE_TYPE, TableShapeProps>;
export type LinkShape = TLBaseShape<typeof LINK_SHAPE_TYPE, LinkShapeProps>;
export type ImageShape = TLBaseShape<typeof IMAGE_SHAPE_TYPE, ImageShapeProps>;

const tableRows = T.arrayOf(T.arrayOf(T.string));
const linkProps: RecordProps<LinkShape> = { w: T.positiveNumber, h: T.positiveNumber, url: T.string, label: T.string };
const imageProps: RecordProps<ImageShape> = { w: T.positiveNumber, h: T.positiveNumber, src: T.string, alt: T.string };

export class TableShapeUtil extends BaseBoxShapeUtil<TableShape> {
  static override type = TABLE_SHAPE_TYPE;
  static override props: RecordProps<TableShape> = { w: T.positiveNumber, h: T.positiveNumber, rows: tableRows };
  getDefaultProps(): TableShape["props"] { return { w: 480, h: 180, rows: [["Heading", "Heading", "Heading"], ["", "", ""], ["", "", ""]] }; }
  getGeometry(shape: TableShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  component(shape: TableShape) { return <TableShapeComponent shape={shape} />; }
  getIndicatorPath(shape: TableShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}

export class LinkShapeUtil extends BaseBoxShapeUtil<LinkShape> {
  static override type = LINK_SHAPE_TYPE;
  static override props = linkProps;
  getDefaultProps(): LinkShape["props"] { return { w: 360, h: 92, url: "https://example.com", label: "example.com" }; }
  getGeometry(shape: LinkShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  component(shape: LinkShape) { return <LinkShapeComponent shape={shape} />; }
  getIndicatorPath(shape: LinkShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props = imageProps;
  getDefaultProps(): ImageShape["props"] { return { w: 320, h: 240, src: "", alt: "" }; }
  getGeometry(shape: ImageShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  component(shape: ImageShape) { return <ImageShapeComponent shape={shape} />; }
  getIndicatorPath(shape: ImageShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}

function TableShapeComponent({ shape }: { shape: TableShape }) {
  const editor = useEditor();
  const rows = shape.props.rows.length > 0 ? shape.props.rows : [[""]];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const rowHeight = 44;

  const updateRows = (nextRows: string[][]) => {
    const normalizedRows = nextRows.length > 0 ? nextRows : [Array.from({ length: columnCount }, () => "")];
    editor.updateShape({ id: shape.id, type: shape.type, props: { rows: normalizedRows, h: Math.max(120, normalizedRows.length * rowHeight + 44) } });
  };
  const updateCell = (rowIndex: number, columnIndex: number, value: string) => updateRows(rows.map((row, currentRow) => {
    const normalizedRow = Array.from({ length: columnCount }, (_, currentColumn) => row[currentColumn] ?? "");
    return currentRow === rowIndex ? normalizedRow.map((cell, currentColumn) => currentColumn === columnIndex ? value : cell) : normalizedRow;
  }));
  const addRow = () => updateRows([...rows.map((row) => [...row, ...Array.from({ length: columnCount - row.length }, () => "")]), Array.from({ length: columnCount }, () => "")]);
  const addColumn = () => updateRows(rows.map((row) => [...row, ""]));
  const removeRow = () => { if (rows.length > 1) updateRows(rows.slice(0, -1)); };
  const removeColumn = () => { if (columnCount > 1) updateRows(rows.map((row) => row.slice(0, -1))); };
  const stopPointer = (event: PointerEvent) => event.stopPropagation();

  return <HTMLContainer className="tldraw-table-shape" style={{ width: shape.props.w, minHeight: Math.max(shape.props.h, rows.length * rowHeight + 44) }} onPointerDown={(event) => { editor.select(shape.id); event.stopPropagation(); }}>
    <div className="tldraw-table-toolbar" onPointerDown={stopPointer}>
      <span>Table</span>
      <div className="tldraw-table-actions">
        <button type="button" title="Add row" aria-label="Add row" onPointerDown={stopPointer} onClick={addRow}><Plus /><span>Row</span></button>
        <button type="button" title="Add column" aria-label="Add column" onPointerDown={stopPointer} onClick={addColumn}><Plus /><span>Column</span></button>
        <button type="button" title="Delete last row" aria-label="Delete last row" disabled={rows.length <= 1} onPointerDown={stopPointer} onClick={removeRow}><Trash2 /><span>Row</span></button>
        <button type="button" title="Delete last column" aria-label="Delete last column" disabled={columnCount <= 1} onPointerDown={stopPointer} onClick={removeColumn}><Trash2 /><span>Column</span></button>
      </div>
    </div>
    <table aria-label="Editable table"><tbody>{rows.map((row, rowIndex) => <tr key={`${shape.id}-row-${rowIndex}`}>{Array.from({ length: columnCount }, (_, columnIndex) => <td key={`${shape.id}-cell-${rowIndex}-${columnIndex}`}><input value={row[columnIndex] ?? ""} aria-label={`Table row ${rowIndex + 1}, column ${columnIndex + 1}`} onPointerDown={(event) => event.stopPropagation()} onFocus={() => editor.select(shape.id)} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody></table>
  </HTMLContainer>;
}

function LinkShapeComponent({ shape }: { shape: LinkShape }) {
  const editor = useEditor();
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(shape.props.url);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const saveLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = /^https?:\/\//i.test(draftUrl.trim()) ? draftUrl.trim() : `https://${draftUrl.trim()}`;
    try {
      const url = new URL(normalized);
      editor.updateShape({ id: shape.id, type: shape.type, props: { url: url.toString(), label: url.hostname.replace(/^www\./, "") } });
      setEditing(false);
    } catch { /* Keep editing until the user enters a valid URL. */ }
  };
  return <HTMLContainer className="tldraw-link-shape" style={{ width: shape.props.w, height: shape.props.h }} onPointerDown={(event) => { editor.select(shape.id); event.stopPropagation(); }}>
    <div className="tldraw-link-icon"><ExternalLink /></div>
    {editing ? <form className="tldraw-link-edit-form" onSubmit={saveLink} onPointerDown={(event) => event.stopPropagation()}><input ref={inputRef} aria-label="Edit link address" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} /><button type="submit">Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <><div className="tldraw-link-copy"><strong>{shape.props.label || "Web link"}</strong><a href={shape.props.url} target="_blank" rel="noopener noreferrer" onPointerDown={(event) => event.stopPropagation()}>{shape.props.url}</a></div><button className="tldraw-link-edit" type="button" title="Edit link" aria-label="Edit link" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setDraftUrl(shape.props.url); setEditing(true); }}>Edit</button></>}
  </HTMLContainer>;
}

function ImageShapeComponent({ shape }: { shape: ImageShape }) {
  const editor = useEditor();
  const [failed, setFailed] = useState(false);
  return <HTMLContainer className="tldraw-image-shape" style={{ width: shape.props.w, height: shape.props.h }} onPointerDown={(event) => { editor.select(shape.id); event.stopPropagation(); }}>
    {failed || !shape.props.src ? <div className="tldraw-image-fallback"><ImageOff /><span>Image unavailable</span></div> : <img src={shape.props.src} alt={shape.props.alt} draggable={false} onError={() => setFailed(true)} />}
  </HTMLContainer>;
}
