import type { ListItem } from 'agentfmt'
import { defineCommand } from 'citty'

import type { DescribeArgs } from '@open-pencil/core/rpc'

import { appTargetOptions } from '#cli/app-target'
import { bold, entity, fmtList, printError, formatType } from '#cli/format'
import { loadRpcData } from '#cli/rpc-data'

type DescribeNode = {
  id: string
  name: string
  type: string
  role?: string
  size?: string
  visual?: string
  layout?: string
  issues?: Array<{ severity?: string; message: string; suggestion?: string }>
  children?: DescribeNode[]
}

function collectIssues(
  node: DescribeNode,
  out: Array<{ severity: string; node: string; message: string }>
): void {
  for (const issue of node.issues ?? []) {
    out.push({
      severity: issue.severity ?? 'info',
      node: `${node.name} (${node.id})`,
      message: issue.message
    })
  }
  for (const child of node.children ?? []) collectIssues(child, out)
}

function formatNodeLine(node: DescribeNode, depth: number): string {
  const indent = '  '.repeat(depth)
  const label = entity(formatType(node.type), node.name, node.id)
  const detail = [node.role, node.size, node.layout].filter(Boolean).join(' · ')
  return `${indent}${label}${detail ? ` — ${detail}` : ''}`
}

function printTree(nodes: DescribeNode[], depth = 0): void {
  for (const node of nodes) {
    console.log(formatNodeLine(node, depth))
    if (node.children?.length) printTree(node.children, depth + 1)
  }
}

const SEVERITY_MARKERS: Record<string, string> = { error: '✗', warning: '!' }

function issueListItem(issue: { severity: string; node: string; message: string }): ListItem {
  const severityLabel = SEVERITY_MARKERS[issue.severity] ?? '·'
  return { header: `${severityLabel} ${issue.message}`, details: { node: issue.node } }
}

export default defineCommand({
  meta: {
    description: 'Semantic quality report (tree roles, summaries, issues, layout issues) for nodes'
  },
  args: {
    file: {
      type: 'positional',
      description: 'Document file path (omit to connect to running app)',
      required: false
    },
    id: { type: 'string', description: 'Describe a single node by ID' },
    ids: { type: 'string', description: 'Comma-separated node IDs to describe' },
    page: { type: 'string', description: 'Page name (default: first page)' },
    depth: { type: 'string', description: 'Max depth (default: auto)' },
    grid: { type: 'string', description: 'Grid size for alignment checks (default: 8)' },
    ...appTargetOptions,
    json: { type: 'boolean', description: 'Output as JSON' }
  },
  async run({ args }) {
    const describeArgs: DescribeArgs = {
      page: args.page,
      depth: args.depth ? Number(args.depth) : undefined,
      grid: args.grid ? Number(args.grid) : undefined,
      id: args.id,
      ids: args.ids
        ? args.ids
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
    }
    const data = await loadRpcData<{
      page?: { id: string; name: string }
      nodes?: DescribeNode[]
      error?: string
    }>(args.file, 'describe', describeArgs, args)

    if ('error' in data && data.error) {
      printError(data.error)
      process.exit(1)
    }

    if (args.json) {
      console.log(JSON.stringify(data, null, 2))
      return
    }

    const nodes = data.nodes ?? []
    console.log('')
    console.log(
      bold(`  Describe ${data.page ? `page "${data.page.name}"` : `${nodes.length} node(s)`}`)
    )
    console.log('')
    printTree(nodes)
    console.log('')

    const issues: Array<{ severity: string; node: string; message: string }> = []
    for (const node of nodes) collectIssues(node, issues)
    if (issues.length > 0) {
      console.log(bold(`  Issues (${issues.length})`))
      console.log('')
      console.log(fmtList(issues.map(issueListItem)))
      console.log('')
    } else {
      console.log(bold('  No issues detected'))
      console.log('')
    }
  }
})
