#!/usr/bin/env bun
// [custom] alpha-fix: one-shot migration for pre-fix dual-write paint data.
//
// CanvasKit setAlphaf overwrites color.a instead of multiplying it, so older files (created before
// the JSX/set_fill 8-digit-hex fix and the panel dual-write removal) carry SOLID fills/strokes
// where color.a === opacity (both written). After the renderer switch to color.a × opacity those
// paints would render at alpha². This script normalizes them to opacity = 1 so they render at
// exactly color.a (unchanged look) and the data matches Figma semantics (alpha in color.a, opacity
// as an independent multiplier).
//
// Usage:
//   bun run scripts/migrate-alpha-dual-write.ts [--dry-run] [--json] [--dir <dir>] [<file.fig>...]
//
//   positional args    .fig files to process
//   --dir <dir>        scan a directory recursively for .fig files (default: $DESIGN_ROOT or cwd)
//   --dry-run          only report dual writes, do not write back
//   --json             print a machine-readable summary
//
// Not touched: text style-runs, gradient stops, node.opacity, non-SOLID paints.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { populateAllLazyFigImportRoots } from '@open-pencil/core/kiwi'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { markSourceFieldsEdited } from '@open-pencil/scene-graph/source-metadata'

const EPSILON = 0.001

const io = new IORegistry(BUILTIN_IO_FORMATS)

interface DualWriteHit {
  nodeId: string
  nodeName: string
  kind: 'fill' | 'stroke'
  index: number
  colorA: number
  opacity: number
}

interface FileResult {
  file: string
  hits: DualWriteHit[]
  written: boolean
}

interface CliOptions {
  files: string[]
  dir: string | undefined
  dryRun: boolean
  json: boolean
}

function isDualWrite(colorA: number, opacity: number): boolean {
  return colorA < 1 && Math.abs(colorA - opacity) < EPSILON
}

function collectDualWrites(graph: SceneGraph): DualWriteHit[] {
  const hits: DualWriteHit[] = []
  for (const node of graph.getAllNodes()) {
    node.fills.forEach((fill, index) => {
      if (fill.visible && fill.type === 'SOLID' && isDualWrite(fill.color.a, fill.opacity)) {
        hits.push({
          nodeId: node.id,
          nodeName: node.name,
          kind: 'fill',
          index,
          colorA: fill.color.a,
          opacity: fill.opacity
        })
      }
    })
    node.strokes.forEach((stroke, index) => {
      if (stroke.visible && isDualWrite(stroke.color.a, stroke.opacity)) {
        hits.push({
          nodeId: node.id,
          nodeName: node.name,
          kind: 'stroke',
          index,
          colorA: stroke.color.a,
          opacity: stroke.opacity
        })
      }
    })
  }
  return hits
}

function applyMigration(graph: SceneGraph, hits: DualWriteHit[]): void {
  for (const hit of hits) {
    const node = graph.getNode(hit.nodeId)
    if (!node) continue
    if (hit.kind === 'fill') {
      node.fills[hit.index].opacity = 1
      // [custom] alpha-fix: mark fills as edited so the .fig export uses the live node.fills
      // instead of the raw Figma paint data (which carries the old dual-write opacity).
      markSourceFieldsEdited(node, ['fills'])
    } else {
      node.strokes[hit.index].opacity = 1
      markSourceFieldsEdited(node, ['strokes'])
    }
  }
}

async function listFigFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFigFiles(full)))
    } else if (extname(entry.name).toLowerCase() === '.fig') {
      files.push(full)
    }
  }
  return files
}

async function loadGraph(file: string): Promise<SceneGraph> {
  const bytes = new Uint8Array(await readFile(file))
  const { graph } = await io.readDocument({ name: file, data: bytes })
  populateAllLazyFigImportRoots(graph)
  return graph
}

async function collectInputFiles(options: CliOptions): Promise<string[]> {
  if (options.files.length > 0) return options.files.map((file) => resolve(file))
  const base = options.dir ?? process.env.DESIGN_ROOT ?? process.cwd()
  return listFigFiles(base)
}

async function migrateFile(file: string, dryRun: boolean): Promise<FileResult> {
  const graph = await loadGraph(file)
  const hits = collectDualWrites(graph)
  let written = false
  if (hits.length > 0 && !dryRun) {
    applyMigration(graph, hits)
    const result = await io.writeDocument('fig', graph)
    await writeFile(file, result.data as Uint8Array)
    written = true
  }
  return { file, hits, written }
}

function formatHit(hit: DualWriteHit): string {
  const nodeRef = `${hit.nodeName} (${hit.nodeId})`
  return `${hit.kind}[${hit.index}] ${nodeRef} color.a=${hit.colorA.toFixed(3)} opacity=${hit.opacity.toFixed(3)}`
}

function resultStatus(result: FileResult): string {
  if (result.hits.length === 0) return 'clean'
  return result.written ? 'migrated' : 'dry-run'
}

function printReport(results: FileResult[]): void {
  const total = results.reduce((sum, result) => sum + result.hits.length, 0)
  for (const result of results) {
    console.warn(`${basename(result.file)}: ${result.hits.length} dual write(s) [${resultStatus(result)}]`)
    for (const hit of result.hits) {
      console.warn(`  ${formatHit(hit)}`)
    }
  }
  console.warn(`total: ${total} dual write(s) across ${results.length} file(s)`)
}

function printJson(results: FileResult[]): void {
  const summary = results.map((result) => ({
    file: basename(result.file),
    path: result.file,
    dualWrites: result.hits.length,
    migrated: result.written,
    hits: result.hits
  }))
  console.warn(JSON.stringify(summary, null, 2))
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { files: [], dir: undefined, dryRun: false, json: false }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--dir') {
      const value = args[index + 1]
      if (!value) throw new Error('--dir requires a path argument')
      options.dir = resolve(value)
      index++
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      options.files.push(arg)
    }
  }
  return options
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const files = await collectInputFiles(options)
  if (files.length === 0) {
    console.error('no .fig files found')
    process.exit(1)
  }
  const results: FileResult[] = []
  for (const file of files) {
    try {
      results.push(await migrateFile(file, options.dryRun))
    } catch (error) {
      console.error(`failed to process ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (options.json) printJson(results)
  else printReport(results)
}

await run()
