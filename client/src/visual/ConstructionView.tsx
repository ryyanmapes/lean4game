import * as React from 'react'
import { useState, useEffect } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from '@dnd-kit/core'

// ── Construction term types ───────────────────────────────────────────────────

export type ConstructionTerm =
  | { kind: 'slot'; id: string }
  | { kind: 'num';  value: number; id: string }
  | { kind: 'var';  name: string;  id: string }
  | { kind: 'succ'; arg: ConstructionTerm; id: string }
  | { kind: 'add';  left: ConstructionTerm; right: ConstructionTerm; id: string }
  | { kind: 'mul';  left: ConstructionTerm; right: ConstructionTerm; id: string }

function genId(): string { return Math.random().toString(36).slice(2, 10) }
function makeSlot(): ConstructionTerm  { return { kind: 'slot', id: genId() } }
function makeNum(v: number): ConstructionTerm { return { kind: 'num',  value: v, id: genId() } }
function makeVar(n: string): ConstructionTerm  { return { kind: 'var',  name: n,  id: genId() } }
function makeSucc(): ConstructionTerm { return { kind: 'succ', arg: makeSlot(), id: genId() } }
function makeAdd():  ConstructionTerm { return { kind: 'add',  left: makeSlot(), right: makeSlot(), id: genId() } }
function makeMul():  ConstructionTerm { return { kind: 'mul',  left: makeSlot(), right: makeSlot(), id: genId() } }

export function countSlots(t: ConstructionTerm): number {
  switch (t.kind) {
    case 'slot': return 1
    case 'num': case 'var': return 0
    case 'succ': return countSlots(t.arg)
    case 'add': case 'mul': return countSlots(t.left) + countSlots(t.right)
  }
}

function slotExists(root: ConstructionTerm, id: string): boolean {
  if (root.kind === 'slot') return root.id === id
  if (root.kind === 'num' || root.kind === 'var') return false
  if (root.kind === 'succ') return slotExists(root.arg, id)
  return slotExists(root.left, id) || slotExists(root.right, id)
}

function findFirstSlotId(t: ConstructionTerm): string | null {
  switch (t.kind) {
    case 'slot': return t.id
    case 'num': case 'var': return null
    case 'succ': return findFirstSlotId(t.arg)
    case 'add': case 'mul': return findFirstSlotId(t.left) ?? findFirstSlotId(t.right)
  }
}

function fillSlotById(root: ConstructionTerm, id: string, filler: ConstructionTerm): ConstructionTerm {
  if (root.kind === 'slot') return root.id === id ? filler : root
  if (root.kind === 'num' || root.kind === 'var') return root
  if (root.kind === 'succ') return { ...root, arg: fillSlotById(root.arg, id, filler) }
  return { ...root, left: fillSlotById(root.left, id, filler), right: fillSlotById(root.right, id, filler) }
}

function isAtomTerm(t: ConstructionTerm): boolean {
  return t.kind === 'num' || t.kind === 'var'
}

export function termToLeanString(t: ConstructionTerm): string {
  switch (t.kind) {
    case 'slot': return '_'
    case 'num':  return String(t.value)
    case 'var':  return t.name
    case 'succ': {
      const inner = termToLeanString(t.arg)
      // Construction mode is currently used for the game's custom naturals
      // (`MyNat`, printed with constructor `succ`), so emit the unqualified
      // constructor form Lean expects in these levels.
      return isAtomTerm(t.arg) ? `succ ${inner}` : `succ (${inner})`
    }
    case 'add': {
      const l = termToLeanString(t.left)
      // Parenthesize right-side add to make non-default associativity explicit
      const r = t.right.kind === 'add'
        ? `(${termToLeanString(t.right)})`
        : termToLeanString(t.right)
      return `${l} + ${r}`
    }
    case 'mul': {
      // Parenthesize add sub-terms (lower precedence than *)
      const l = t.left.kind === 'add'
        ? `(${termToLeanString(t.left)})`
        : termToLeanString(t.left)
      const r = (t.right.kind === 'add' || t.right.kind === 'mul')
        ? `(${termToLeanString(t.right)})`
        : termToLeanString(t.right)
      return `${l} * ${r}`
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SlotNode({ id: slotId, selectedSlotId, onSelectSlot }: {
  id: string
  selectedSlotId: string | null
  onSelectSlot: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot_${slotId}` })
  return (
    <button
      ref={setNodeRef}
      className={`cn-slot${slotId === selectedSlotId ? ' selected' : ''}${isOver ? ' drop-hover' : ''}`}
      onClick={() => onSelectSlot(slotId)}
      title="Click to select or drop a brick here"
    >?</button>
  )
}

interface TermDisplayProps {
  term: ConstructionTerm
  selectedSlotId: string | null
  onSelectSlot: (id: string) => void
}

function TermDisplay({ term, selectedSlotId, onSelectSlot }: TermDisplayProps): React.ReactElement {
  if (term.kind === 'slot') {
    return <SlotNode id={term.id} selectedSlotId={selectedSlotId} onSelectSlot={onSelectSlot} />
  }
  if (term.kind === 'num') return <span className="cn-atom cn-num">{term.value}</span>
  if (term.kind === 'var') return <span className="cn-atom cn-var">{term.name}</span>
  if (term.kind === 'succ') {
    return (
      <span className="cn-expr cn-app">
        <span className="cn-func-name">succ</span>
        <span className="cn-paren">(</span>
        <TermDisplay term={term.arg} selectedSlotId={selectedSlotId} onSelectSlot={onSelectSlot} />
        <span className="cn-paren">)</span>
      </span>
    )
  }
  // add or mul
  return (
    <span className="cn-expr cn-binary">
      <TermDisplay term={term.left} selectedSlotId={selectedSlotId} onSelectSlot={onSelectSlot} />
      <span className="cn-op">{term.kind === 'add' ? ' + ' : ' × '}</span>
      <TermDisplay term={term.right} selectedSlotId={selectedSlotId} onSelectSlot={onSelectSlot} />
    </span>
  )
}

function BrickCard({ brickId, label, disabled, onClick }: {
  brickId: string
  label: string
  disabled: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `brick_${brickId}`,
    disabled,
  })
  return (
    <button
      ref={setNodeRef}
      className={`cn-brick${disabled ? ' disabled' : ''}${isDragging ? ' dragging' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      {...listeners}
      {...attributes}
    >
      <span className="cn-brick-label proposition">{label}</span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const MAX_SLOTS = 8
type CnTab = 'everything' | 'variables' | 'numbers' | 'functions'

interface BrickDef {
  id: string
  label: string
  make: () => ConstructionTerm
  tab: CnTab
}

interface Props {
  varName: string
  goalBody: string
  contextVarNames: string[]
  onApply: (exprStr: string) => Promise<boolean>
  onClose: () => void
  isProcessing: boolean
  style?: React.CSSProperties
  headerSlot?: React.ReactNode
}

export function ConstructionView({
  varName, goalBody, contextVarNames, onApply, onClose, isProcessing, style, headerSlot,
}: Props) {
  const [term, setTerm] = useState<ConstructionTerm>(() => makeSlot())
  const [history, setHistory] = useState<ConstructionTerm[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<CnTab>('everything')
  const [isDoneProcessing, setIsDoneProcessing] = useState(false)
  const [doneError, setDoneError] = useState(false)
  const [activeBrickId, setActiveBrickId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const slotCount = countSlots(term)
  const isComplete = slotCount === 0
  const canUndo = history.length > 0
  const busy = isProcessing || isDoneProcessing

  // Clear stale slot selection when the selected slot gets filled
  useEffect(() => {
    if (selectedSlotId !== null && !slotExists(term, selectedSlotId)) {
      setSelectedSlotId(null)
    }
  }, [term, selectedSlotId])

  function handleSelectSlot(id: string) {
    setSelectedSlotId(prev => prev === id ? null : id)
  }

  function fillSlot(makeBrick: () => ConstructionTerm, targetSlotId: string) {
    if (busy) return
    const brick = makeBrick()
    const newTotal = slotCount - 1 + countSlots(brick)
    if (newTotal > MAX_SLOTS) return
    setHistory(prev => [...prev, term])
    setTerm(prev => fillSlotById(prev, targetSlotId, brick))
    setSelectedSlotId(null)
  }

  function handleBrick(makeBrick: () => ConstructionTerm) {
    const targetId = selectedSlotId ?? findFirstSlotId(term)
    if (!targetId) return
    fillSlot(makeBrick, targetId)
  }

  function handleUndo() {
    if (!canUndo || busy) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setTerm(prev)
    setSelectedSlotId(null)
  }

  async function handleDone() {
    if (!isComplete || busy) return
    setIsDoneProcessing(true)
    setDoneError(false)
    const success = await onApply(termToLeanString(term))
    setIsDoneProcessing(false)
    if (success) {
      onClose()
    } else {
      setDoneError(true)
      setTimeout(() => setDoneError(false), 600)
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const rawId = String(event.active.id).replace(/^brick_/, '')
    setActiveBrickId(rawId)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveBrickId(null)
    const { active, over } = event
    if (!over) return
    const rawBrickId = String(active.id).replace(/^brick_/, '')
    const rawSlotId = String(over.id).replace(/^slot_/, '')
    const brick = allBricks.find(b => b.id === rawBrickId)
    if (!brick) return
    fillSlot(brick.make, rawSlotId)
  }

  // Build brick definitions
  const varBricks: BrickDef[] = contextVarNames.map(name => ({
    id: `var_${name}`, label: name, make: () => makeVar(name), tab: 'variables',
  }))
  const numBricks: BrickDef[] = [0, 1, 2, 3, 4].map(n => ({
    id: `num_${n}`, label: String(n), make: () => makeNum(n), tab: 'numbers',
  }))
  const fnBricks: BrickDef[] = [
    { id: 'fn_succ', label: 'succ( _ )', make: makeSucc, tab: 'functions' },
    { id: 'fn_add',  label: '_ + _',    make: makeAdd,  tab: 'functions' },
    { id: 'fn_mul',  label: '_ × _',    make: makeMul,  tab: 'functions' },
  ]
  const allBricks = [...varBricks, ...numBricks, ...fnBricks]
  const displayedBricks = selectedTab === 'everything'
    ? allBricks
    : allBricks.filter(b => b.tab === selectedTab)

  const TABS: { id: CnTab; label: string; disabled?: boolean }[] = [
    { id: 'everything', label: 'Everything' },
    { id: 'variables',  label: 'Variables', disabled: varBricks.length === 0 },
    { id: 'numbers',    label: 'Numbers' },
    { id: 'functions',  label: 'Functions' },
  ]

  const activeBrickDef = activeBrickId ? allBricks.find(b => b.id === activeBrickId) : null

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveBrickId(null)}>
      <div className="visual-page tr-overlay" style={style}>
        {headerSlot}

        {/* Back button */}
        <button className="tr-back-btn" onClick={onClose} disabled={busy}>
          ← Back
        </button>

        {/* Processing overlay */}
        {busy && <div className="tr-processing" />}

        {/* Main area */}
        <div className="tr-main-area cn-main-area">

          {/* "Propose x such that P x" header */}
          <div className="cn-propose-label">
            <span className="cn-propose-keyword">Propose</span>
            {' '}
            <span className="cn-propose-var">{varName}</span>
            {' '}
            <span className="cn-propose-keyword">such that</span>
            {' '}
            <span className="cn-propose-body proposition">{goalBody}</span>
          </div>

          {/* Term display */}
          <div className="cn-term-display">
            <TermDisplay
              term={term}
              selectedSlotId={selectedSlotId}
              onSelectSlot={handleSelectSlot}
            />
          </div>

          {/* Undo — same position as in TransformationView */}
          <div className="tr-controls">
            <button
              onClick={handleUndo}
              disabled={!canUndo || busy}
              className={`tr-ctrl-btn${canUndo ? ' active-undo' : ''}`}
              title="Undo last fill"
            >↩</button>
          </div>

          {/* Done — replaces the reverse button */}
          <div className="tr-side-controls">
            <button
              onClick={() => void handleDone()}
              disabled={!isComplete || busy}
              className={`cn-done-btn${isComplete ? ' ready' : ''}${doneError ? ' error' : ''}`}
              title={isComplete ? 'Submit witness to Lean' : 'Fill all slots to continue'}
            >Done ›</button>
          </div>
        </div>

        {/* Brick dock */}
        <div className="tr-rule-dock">
          <div className="tr-dock-cards cn-dock-cards">
            {displayedBricks.length > 0 ? (
              displayedBricks.map(brick => {
                const brickSlots = countSlots(brick.make())
                // net new slots = brickSlots - 1 (we're replacing one slot with the brick)
                const newTotal = slotCount - 1 + brickSlots
                const disabled = slotCount === 0 || newTotal > MAX_SLOTS || busy
                return (
                  <BrickCard
                    key={brick.id}
                    brickId={brick.id}
                    label={brick.label}
                    disabled={disabled}
                    onClick={() => handleBrick(brick.make)}
                  />
                )
              })
            ) : (
              <span className="tr-no-rules">No items available</span>
            )}
          </div>
          <div className="tr-page-indicator">Page 1 of 1</div>

          <div className="tr-dock-tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`tr-tab-btn${selectedTab === tab.id ? ' active' : ''}`}
                onClick={() => { if (!tab.disabled) setSelectedTab(tab.id) }}
                disabled={tab.disabled}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeBrickDef
            ? <div className="cn-brick"><span className="cn-brick-label proposition">{activeBrickDef.label}</span></div>
            : null}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
