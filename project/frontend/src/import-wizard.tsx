import { useMemo, useRef, useState, type DragEvent } from 'react'
import {
  importData,
  type Category,
  type ImportPayload,
  type ImportResult,
  type Product,
} from './data-access'
import { Button, Icon } from './ui'

type DataType = 'categories' | 'products' | 'orders' | 'orderItems'
type Stage = 'upload' | 'mapping' | 'preview' | 'confirm' | 'success'

const DATA_TYPES: { value: DataType; label: string; description: string }[] = [
  { value: 'categories', label: 'Categories', description: 'Menu groups and sections' },
  { value: 'products', label: 'Products', description: 'Items, prices, and categories' },
  { value: 'orders', label: 'Historical sales', description: 'Past transactions and totals' },
  { value: 'orderItems', label: 'Order items', description: 'Products and quantities per order' },
]

const FIELDS: Record<DataType, { value: string; label: string; required?: boolean }[]> = {
  categories: [{ value: 'category_name', label: 'Category name', required: true }],
  products: [
    { value: 'source_product_id', label: 'Product ID' },
    { value: 'product_name', label: 'Product name', required: true },
    { value: 'category_id', label: 'Category / Category ID', required: true },
    { value: 'price', label: 'Price', required: true },
  ],
  orders: [
    { value: 'source_order_id', label: 'Order / Transaction ID' },
    { value: 'order_date', label: 'Order date', required: true },
    { value: 'order_time', label: 'Order time' },
    { value: 'day_of_week', label: 'Day of week' },
    { value: 'total', label: 'Order total', required: true },
  ],
  orderItems: [
    { value: 'order_id', label: 'Order / Transaction ID', required: true },
    { value: 'product_id', label: 'Product ID', required: true },
    { value: 'quantity', label: 'Quantity', required: true },
    { value: 'item_price', label: 'Item price', required: true },
  ],
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function suggestField(column: string, available: { value: string; label: string }[]): string {
  const source = normalize(column)
  return available.find((field) => {
    const value = normalize(field.value)
    const label = normalize(field.label)
    return source === value || source === label || source.includes(value) || label.includes(source)
  })?.value ?? ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  return Number(String(value).replace(/[$,\s]/g, ''))
}

function dateValue(value: unknown): string {
  if (typeof value === 'number') {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
    if (!Number.isNaN(excelDate.getTime())) return excelDate.toISOString().slice(0, 10)
  }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function timeValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(11, 19)
  if (typeof value === 'number' && value >= 0 && value < 1) {
    return new Date(Math.round(value * 86_400) * 1000).toISOString().slice(11, 19)
  }
  return String(value ?? '').trim().replace(/^(\d):/, '0$1:') || '12:00:00'
}

export function ImportWizard({
  categories,
  products,
  onClose,
  onImported,
}: {
  categories: Category[]
  products: Product[]
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('upload')
  const [types, setTypes] = useState<DataType[]>(['products'])
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const availableFields = useMemo(
    () => types.flatMap((type) => FIELDS[type].map((field) => ({ ...field, group: DATA_TYPES.find((item) => item.value === type)?.label ?? type }))),
    [types],
  )
  const mappedRows = useMemo(() => rows.map((row) => {
    const mapped: Record<string, unknown> = {}
    columns.forEach((column) => {
      if (mapping[column]) mapped[mapping[column]] = row[column]
    })
    return mapped
  }), [columns, mapping, rows])
  const requiredFields = useMemo(() => types.flatMap((type) => FIELDS[type].filter((field) => field.required).map((field) => field.value)), [types])
  const validations = useMemo(() => mappedRows.map((row, index) => {
    const missing = requiredFields.filter((field) => row[field] === '' || row[field] === undefined || row[field] === null)
    const invalidNumbers = ['price', 'total', 'quantity', 'item_price']
      .filter((field) => row[field] !== undefined && (!Number.isFinite(numberValue(row[field])) || numberValue(row[field]) < 0))
    const productName = String(row.product_name ?? '').trim().toLowerCase()
    const duplicate = Boolean(productName) && (
      products.some((product) => product.product_name.toLowerCase() === productName) ||
      mappedRows.slice(0, index).some((other) => String(other.product_name ?? '').trim().toLowerCase() === productName)
    )
    return { row, missing, invalidNumbers, duplicate, valid: missing.length === 0 && invalidNumbers.length === 0 && !duplicate }
  }), [mappedRows, products, requiredFields])
  const validRows = validations.filter((item) => item.valid)
  const invalidRows = validations.filter((item) => !item.valid)

  function toggleType(type: DataType): void {
    setTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])
  }

  async function loadFile(selected: File): Promise<void> {
    setError('')
    if (!/\.(csv|xlsx)$/i.test(selected.name)) {
      setError('Choose a CSV or Excel (.xlsx) file.')
      return
    }
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await selected.arrayBuffer(), { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (!parsed.length) throw new Error('The selected file has no data rows.')
      const nextColumns = Object.keys(parsed[0])
      const nextMapping: Record<string, string> = {}
      const fields = types.flatMap((type) => FIELDS[type])
      nextColumns.forEach((column) => { nextMapping[column] = suggestField(column, fields) })
      setFile(selected)
      setRows(parsed)
      setColumns(nextColumns)
      setMapping(nextMapping)
      setStage('mapping')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The file could not be read.')
    }
  }

  function dropFile(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragging(false)
    const selected = event.dataTransfer.files[0]
    if (selected) void loadFile(selected)
  }

  function buildPayload(): ImportPayload {
    const usable = validRows.map((item) => item.row)
    const importedCategoryNames = [...new Set(usable.map((row) => String(row.category_name ?? '').trim()).filter(Boolean))]
    const categoryIdByName = new Map(categories.map((item) => [item.category_name.toLowerCase(), item.category_id]))

    return {
      categories: types.includes('categories') ? importedCategoryNames.map((category_name) => ({ category_name })) : [],
      products: types.includes('products') ? usable.map((row) => {
        const rawCategory = String(row.category_id ?? '').trim()
        const numericCategory = Number(rawCategory)
        const namedCategory = Number.isNaN(numericCategory)
        return {
          source_product_id: numberValue(row.source_product_id) || undefined,
          product_name: String(row.product_name).trim(),
          category_id: namedCategory ? (categoryIdByName.get(rawCategory.toLowerCase()) ?? 0) : numericCategory,
          category_name: namedCategory ? rawCategory : undefined,
          price: numberValue(row.price),
        }
      }) : [],
      orders: types.includes('orders') ? usable.map((row) => {
        const orderDate = dateValue(row.order_date)
        const date = new Date(`${orderDate}T12:00:00`)
        return {
          source_order_id: numberValue(row.source_order_id) || undefined,
          order_date: orderDate,
          order_time: timeValue(row.order_time),
          day_of_week: String(row.day_of_week || date.toLocaleDateString('en-US', { weekday: 'long' })),
          customer_phone: null,
          promocode: null,
          discount: 0,
          total: numberValue(row.total),
        }
      }) : [],
      orderItems: types.includes('orderItems') ? usable.map((row) => ({
        order_id: numberValue(row.order_id),
        product_id: numberValue(row.product_id),
        quantity: numberValue(row.quantity),
        price: numberValue(row.item_price),
      })) : [],
    }
  }

  async function confirmImport(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const imported = await importData(buildPayload())
      setResult(imported)
      onImported(imported)
      setStage('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const stepNumber = stage === 'upload' ? 1 : stage === 'mapping' ? 2 : stage === 'preview' ? 3 : 4

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/45 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section className="flex h-full w-full max-w-3xl flex-col bg-canvas shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-line bg-white px-6 py-5">
          <div><div className="text-xs font-bold uppercase tracking-widest text-accent">Business setup</div><h2 id="import-title" className="mt-1 font-display text-2xl font-bold">Import existing data</h2></div>
          <button className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong" onClick={onClose} aria-label="Close import">×</button>
        </header>
        {stage !== 'success' && (
          <div className="border-b border-line bg-white px-6 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-faint">
              {['Upload', 'Map columns', 'Review', 'Confirm'].map((label, index) => <div key={label} className={`flex flex-1 items-center gap-2 ${index + 1 <= stepNumber ? 'text-accent-strong' : ''}`}><span className={`flex size-6 items-center justify-center rounded-full ${index + 1 <= stepNumber ? 'bg-accent text-white' : 'bg-surface-strong'}`}>{index + 1}</span><span className="hidden sm:inline">{label}</span></div>)}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-5 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>}
          {stage === 'upload' && (
            <div>
              <h3 className="font-display text-lg font-bold">What would you like to import?</h3>
              <p className="mt-1 text-sm text-ink-muted">Choose one or more record types contained in your spreadsheet.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {DATA_TYPES.map((item) => <button key={item.value} onClick={() => toggleType(item.value)} className={`rounded-2xl border p-4 text-left transition ${types.includes(item.value) ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:border-accent/40'}`}><div className="flex items-center gap-3"><span className={`flex size-5 items-center justify-center rounded-md border ${types.includes(item.value) ? 'border-accent bg-accent text-white' : 'border-line'}`}>{types.includes(item.value) ? '✓' : ''}</span><div><strong className="text-sm">{item.label}</strong><p className="mt-0.5 text-xs text-ink-muted">{item.description}</p></div></div></button>)}
              </div>
              <div className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragging ? 'border-accent bg-accent-soft' : 'border-line bg-white'}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name="arrow" className="size-6 -rotate-90" /></div>
                <h3 className="mt-4 font-display font-bold">Drop your spreadsheet here</h3>
                <p className="mt-1 text-sm text-ink-muted">CSV or Excel (.xlsx)</p>
                <Button className="mt-5" onClick={() => inputRef.current?.click()} disabled={types.length === 0}>Browse files</Button>
                <input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void loadFile(selected) }} />
              </div>
            </div>
          )}
          {stage === 'mapping' && (
            <div>
              <FileSummary file={file} rows={rows.length} onRemove={() => { setFile(null); setRows([]); setStage('upload') }} />
              <h3 className="mt-7 font-display text-lg font-bold">Match your columns</h3>
              <p className="mt-1 text-sm text-ink-muted">Tell PointNull what each spreadsheet column represents.</p>
              <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-white">
                {columns.map((column) => <div key={column} className="grid items-center gap-3 border-b border-line p-4 last:border-0 sm:grid-cols-[1fr_auto_1fr]"><div><span className="text-xs text-ink-faint">Spreadsheet column</span><strong className="mt-1 block text-sm">{column}</strong></div><span className="hidden text-ink-faint sm:block">→</span><label><span className="sr-only">Map {column}</span><select className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent" value={mapping[column] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [column]: event.target.value }))}><option value="">Do not import</option>{types.map((type) => <optgroup key={type} label={DATA_TYPES.find((item) => item.value === type)?.label}>{FIELDS[type].map((field) => <option key={field.value} value={field.value}>{field.label}{field.required ? ' *' : ''}</option>)}</optgroup>)}</select></label></div>)}
              </div>
            </div>
          )}
          {stage === 'preview' && (
            <div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Rows detected" value={rows.length} /><Stat label="Valid" value={validRows.length} tone="good" /><Stat label="Invalid" value={invalidRows.length} tone={invalidRows.length ? 'bad' : undefined} /><Stat label="Duplicates" value={validations.filter((item) => item.duplicate).length} /></div>
              <h3 className="mt-7 font-display text-lg font-bold">Data preview</h3>
              <p className="mt-1 text-sm text-ink-muted">Invalid and duplicate rows will be skipped.</p>
              <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-white"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-surface-strong text-ink-muted"><tr><th className="p-3">Row</th>{availableFields.filter((field) => Object.values(mapping).includes(field.value)).slice(0, 5).map((field) => <th key={field.value} className="p-3">{field.label}</th>)}<th className="p-3">Status</th></tr></thead><tbody>{validations.slice(0, 8).map((item, index) => <tr key={index} className="border-t border-line"><td className="p-3">{index + 2}</td>{availableFields.filter((field) => Object.values(mapping).includes(field.value)).slice(0, 5).map((field) => <td key={field.value} className="max-w-40 truncate p-3">{String(item.row[field.value] ?? '—')}</td>)}<td className="p-3">{item.valid ? <span className="rounded-full bg-accent-soft px-2 py-1 font-semibold text-accent-strong">Valid</span> : <span className="rounded-full bg-danger-soft px-2 py-1 font-semibold text-danger">{item.duplicate ? 'Duplicate' : `Missing ${item.missing.join(', ') || item.invalidNumbers.join(', ')}`}</span>}</td></tr>)}</tbody></table></div>
            </div>
          )}
          {stage === 'confirm' && (
            <div>
              <div className="rounded-2xl border border-line bg-white p-6">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name="check" className="size-6" /></div>
                <h3 className="mt-5 font-display text-xl font-bold">Ready to import</h3>
                <p className="mt-1 text-sm text-ink-muted">Review the records that will be added to your PointNull workspace.</p>
                <div className="mt-6 divide-y divide-line">{DATA_TYPES.map((item) => <div key={item.value} className="flex items-center justify-between py-3"><span className="text-sm text-ink-muted">{item.label}</span><strong>{types.includes(item.value) ? validRows.length : 0}</strong></div>)}</div>
                <p className="mt-5 rounded-xl bg-surface-strong p-3 text-xs leading-5 text-ink-muted">PointNull will preserve product/category and order/order-item relationships where valid IDs are provided. Invalid references are skipped.</p>
              </div>
            </div>
          )}
          {stage === 'success' && (
            <div className="flex min-h-[480px] flex-col items-center justify-center text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-accent text-white"><Icon name="check" className="size-8" /></div>
              <h3 className="mt-6 font-display text-2xl font-bold">Import complete</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">Your records are now part of the same PointNull dataset used by Sell and Analysis.</p>
              <div className="mt-6 flex gap-4 text-sm"><span><strong>{result?.products.length ?? 0}</strong> products</span><span><strong>{result?.orders.length ?? 0}</strong> orders</span><span><strong>{result?.orderItems.length ?? 0}</strong> items</span></div>
              <Button variant="primary" className="mt-8 min-w-36" onClick={onClose}>Done</Button>
            </div>
          )}
        </div>
        {stage !== 'upload' && stage !== 'success' && (
          <footer className="flex items-center justify-between border-t border-line bg-white px-6 py-4">
            <Button onClick={() => setStage(stage === 'mapping' ? 'upload' : stage === 'preview' ? 'mapping' : 'preview')}>Back</Button>
            {stage === 'mapping' && <Button variant="primary" onClick={() => setStage('preview')} disabled={requiredFields.some((field) => !Object.values(mapping).includes(field))}>Preview data</Button>}
            {stage === 'preview' && <Button variant="primary" onClick={() => setStage('confirm')} disabled={validRows.length === 0}>Continue</Button>}
            {stage === 'confirm' && <Button variant="primary" onClick={() => void confirmImport()} disabled={busy}>{busy ? 'Importing…' : 'Confirm import'}</Button>}
          </footer>
        )}
      </section>
    </div>
  )
}

function FileSummary({ file, rows, onRemove }: { file: File | null; rows: number; onRemove: () => void }) {
  return <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4"><div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-xs font-black uppercase text-accent">{file?.name.split('.').pop()}</div><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{file?.name}</strong><span className="text-xs text-ink-muted">{rows} rows detected · Ready to map</span></div><Button variant="ghost" onClick={onRemove}>Remove</Button></div>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return <div className="rounded-2xl border border-line bg-white p-4"><span className="text-xs font-semibold text-ink-faint">{label}</span><strong className={`mt-2 block font-display text-2xl ${tone === 'good' ? 'text-accent-strong' : tone === 'bad' ? 'text-danger' : ''}`}>{value}</strong></div>
}
